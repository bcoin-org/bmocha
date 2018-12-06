'use strict';

/* global performance */
/* eslint no-var: "off" */

var perf = (function() {
  if (typeof performance !== 'object')
    return null;

  if (!performance)
    return null;

  if (typeof performance.now !== 'function')
    return null;

  try {
    if (typeof performance.now() !== 'number')
      return null;
  } catch (e) {
    return null;
  }

  return performance;
})();

var boot = Number(new Date());

module.exports = {
  performance: {
    nodeTiming: {
      name: 'node',
      entryType: 'node',
      startTime: 0,
      duration: 0,
      nodeStart: 0,
      v8Start: 0,
      bootstrapComplete: 0,
      environment: 0,
      loopStart: 0,
      loopExit: -1,
      thirdPartyMainStart: undefined,
      thirdPartyMainEnd: undefined,
      clusterSetupStart: undefined,
      clusterSetupEnd: undefined,
      moduleLoadStart: undefined,
      moduleLoadEnd: undefined,
      preloadModuleLoadStart: undefined,
      preloadModuleLoadEnd: undefined
    },
    now: function() {
      if (perf)
        return perf.now();

      var now = Number(new Date()) - boot;

      if (now < 0) {
        boot = Number(new Date());
        now = 0;
      }

      return now;
    }
  },
  PerformanceObserver: null,
  constants: {
     NODE_PERFORMANCE_GC_MAJOR: 2,
     NODE_PERFORMANCE_GC_MINOR: 1,
     NODE_PERFORMANCE_GC_INCREMENTAL: 4,
     NODE_PERFORMANCE_GC_WEAKCB: 8
  }
};
