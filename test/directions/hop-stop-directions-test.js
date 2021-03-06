var helper = require('../helper'),
    lib = helper.lib
    vows = helper.vows,
    assert = helper.assert,
    sinon = helper.sinon;

var async = require('async');

var GoogleResult = require('../fixtures/google-result'),
    HopStopResult = require('../fixtures/hop-stop-result');
var directionsBehavior = require('../directions-behavior');

var Directions = lib.require('./directions'),
    GoogleDirectionsRoute = lib.require('./directions/google-directions-route'),
    HootrootApi = lib.require('./hootroot-api'),
    HopStopDirections = lib.require('./directions/hop-stop-directions')
    SubwayingSegment = lib.require('./segment/subwaying-segment'),
    WalkingSegment = lib.require('./segment/walking-segment');

var directions = new HopStopDirections('A','B','WALKING','now');

var goodDirections = new HopStopDirections('A','B');
goodDirections.storeRoute({routes: [{ legs: [HopStopResult.realSubway] }]});
sinon.stub(goodDirections, 'isAllWalkingSegments').returns(false);
sinon.stub(goodDirections.geocoder, 'geocode').
  yields(directionsBehavior.geocodedOrigin,
         directionsBehavior.geocodedDestination);
var badDirections = new HopStopDirections('A','B');
sinon.stub(badDirections, 'isAllWalkingSegments').returns(true);
sinon.stub(badDirections.geocoder, 'geocode').
  yields(directionsBehavior.geocodedOrigin,
         directionsBehavior.geocodedDestination);

var fakeweb = require('fakeweb'),
    http = require('http');

http.register_intercept({
  uri: '/hopstops?x1=1&y1=1&x2=1&y2=1&mode=PUBLICTRANSIT&when=now', 
  host: 'cm1-route.brighterplanet.com',
  body: JSON.stringify(HopStopResult.subway)
});

vows.describe('HopStopDirections').addBatch({
  '#route': directionsBehavior.providesRoute(goodDirections, badDirections, sinon.testCase({
    'uses railCallbackFallback event for SUBWAYING': function() {
      sinon.stub(async, 'parallel');
      sinon.spy(HopStopDirections.events, 'railFallbackCallback');
      directions.mode = 'SUBWAYING';
      directions.route(sinon.stub());
      sinon.assert.called(HopStopDirections.events.railFallbackCallback);

      async.parallel.restore();
      HopStopDirections.events.railFallbackCallback.restore();
    },
    'uses busFallbackCallback event for BUSSING': function() {
      sinon.stub(async, 'parallel');
      sinon.spy(HopStopDirections.events, 'busFallbackCallback');
      directions.mode = 'BUSSING';
      directions.route(sinon.stub());
      sinon.assert.called(HopStopDirections.events.busFallbackCallback);

      async.parallel.restore();
      HopStopDirections.events.busFallbackCallback.restore();
    }
  })),

  '#storeRoute': directionsBehavior.proviesStoreRoute(goodDirections),
  '#calculateDistance': directionsBehavior.proviesCalculateDistance(goodDirections),

  '.shouldDefaultTransitToDirectRoute': {
    'returns true for an AllWalkingSegmentsError and TRANSIT_DIRECT_DEFAULT env is true': function() {
      process.env.TRANSIT_DIRECT_DEFAULT = true;
      var err = new HopStopDirections.AllWalkingSegmentsError('FAIL');
      assert.isTrue(HopStopDirections.shouldDefaultTransitToDirectRoute(err));
    },
    'returns true for an HopStopError and TRANSIT_DIRECT_DEFAULT env is true': function() {
      process.env.TRANSIT_DIRECT_DEFAULT = true;
      var err = new HootrootApi.HopStopError('FAIL');
      assert.isTrue(HopStopDirections.shouldDefaultTransitToDirectRoute(err));
    },
    'returns false for null err': function() {
      process.env.TRANSIT_DIRECT_DEFAULT = true;
      assert.isFalse(HopStopDirections.shouldDefaultTransitToDirectRoute(null));
    },
    'returns false for non-AllWalkingSegmentsError and non-HopStopError': function() {
      process.env.TRANSIT_DIRECT_DEFAULT = true;
      var err = new Error('LULZ');
      assert.isFalse(HopStopDirections.shouldDefaultTransitToDirectRoute(null));
    },
    'returns false if TRANSIT_DIRECT_DEFAULT env is false': function() {
      process.env.TRANSIT_DIRECT_DEFAULT = false;
      var err = new HopStopDirections.AllWalkingSegmentsError('FAIL');
      assert.isFalse(HopStopDirections.shouldDefaultTransitToDirectRoute(err));
    }
  },

  '#fetchHopStop': sinon.testCase({
    'sends a request to HopStop API': function() {
      var hopstop = sinon.spy(HootrootApi, 'hopstop');

      directions.params = function() { 
        return {
          x1: 1, y1: 1, x2: 1, y2: 1,
          mode: 'PUBLICTRANSIT', when: 'now'
        };
      };
      directions.fetchHopStop(sinon.stub());

      assert.deepEqual(hopstop.getCall(0).args[0], {
        x1: 1, y1: 1, x2: 1, y2: 1,
        mode: 'PUBLICTRANSIT', when: 'now'
      });

      HootrootApi.hopstop.restore();
    }
  }),

  '.translateRoute': {
    'creates a google.maps.DirectionsRoute-like object from Hopstop directions': function() {
      var route = HopStopDirections.translateRoute(HopStopResult.realSubway).routes[0];
      assert.instanceOf(route.bounds, google.maps.LatLngBounds);
      assert.include(route.copyrights, 'HopStop');
      assert.equal(route.overview_path.length, 4);
      assert.equal(route.legs.length, 1);
      assert.equal(route.legs[0].steps.length, 5);
      assert.equal(route.warnings.length, 0);
    }
  },

  '.generateOverviewPath': {
    'converts steps into an array of LatLngs': function() {
      var path = HopStopDirections.generateOverviewPath(HopStopResult.realSubway.steps);
      assert.approximately(path[0].lat(), 40.6819, 0.000001);
      assert.approximately(path[0].lng(), -73.90871, 0.000001);
      assert.approximately(path[1].lat(), 40.68265, 0.000001);
      assert.approximately(path[1].lng(), -73.91002, 0.000001);
      assert.approximately(path[2].lat(), 40.74577, 0.000001);
      assert.approximately(path[2].lng(), -73.98222, 0.000001);
      assert.approximately(path[3].lat(), 40.746824, 0.000001);
      assert.approximately(path[3].lng(), -73.983644, 0.000001);
    }
  },

  '.generateSteps': {
    'returns an array of DirectionSteps': function() {
      var steps = HopStopDirections.generateGoogleSteps(HopStopResult.realSubway.steps);
      assert.equal(steps.length, 5);
      assert.equal(steps[0].duration.value, 32400);
      assert.approximately(steps[0].start_location.lat(), 40.6819, 0.0001);
      assert.approximately(steps[0].start_location.lng(), -73.90871, 0.00001);
      assert.approximately(steps[0].end_location.lat(), 40.68265, 0.00001);
      assert.approximately(steps[0].end_location.lng(), -73.91002, 0.00001);
      assert.include(steps[0].instructions, 'Start out');
      assert.include(steps[0].travel_mode, 'WALKING');
      assert.approximately(steps[0].path[0].lat(), 40.6819, 0.0001);
      assert.approximately(steps[0].path[0].lng(), -73.90871, 0.00001);
      assert.approximately(steps[0].path[1].lat(), 40.68265, 0.00001);
      assert.approximately(steps[0].path[1].lng(), -73.91002, 0.00001);
    }
  }
}).export(module, { error: false });
