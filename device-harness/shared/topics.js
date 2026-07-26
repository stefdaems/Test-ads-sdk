/**
 * topics.js — canonical MQTT topic scheme shared by the manager and the app.
 *
 * Loaded in Node via require() (manager, smoke test) and in the browser via a
 * <script> tag (device app), exactly like shared/catalogue.js.
 *
 * Topic layout (prefix defaults to `adsdk`):
 *
 *   <prefix>/register                     device -> broker : announce presence
 *   <prefix>/devices/<id>/status          device -> broker : retained online/offline (+ LWT)
 *   <prefix>/devices/<id>/cmd             manager -> device: install / run / run_all commands
 *   <prefix>/devices/<id>/install         device -> broker : app install progress/result
 *   <prefix>/devices/<id>/event           device -> broker : live debug/trace events
 *   <prefix>/devices/<id>/result          device -> broker : per-scenario result
 *   <prefix>/devices/<id>/run-complete    device -> broker : run_all finished
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdSdkTopics = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PREFIX = 'adsdk';

  function make(prefix) {
    var p = prefix || PREFIX;
    return {
      prefix: p,
      register: p + '/register',
      status: function (id) { return p + '/devices/' + id + '/status'; },
      cmd: function (id) { return p + '/devices/' + id + '/cmd'; },
      install: function (id) { return p + '/devices/' + id + '/install'; },
      event: function (id) { return p + '/devices/' + id + '/event'; },
      result: function (id) { return p + '/devices/' + id + '/result'; },
      runComplete: function (id) { return p + '/devices/' + id + '/run-complete'; },
      // Wildcard subscriptions the manager listens on.
      subscriptions: [
        p + '/register',
        p + '/devices/+/status',
        p + '/devices/+/install',
        p + '/devices/+/event',
        p + '/devices/+/result',
        p + '/devices/+/run-complete',
      ],
      // Extract the device id from a `<prefix>/devices/<id>/<leaf>` topic.
      deviceIdOf: function (topic) {
        var m = new RegExp('^' + p + '/devices/([^/]+)/').exec(topic);
        return m ? m[1] : null;
      },
    };
  }

  var api = make(PREFIX);
  api.make = make;
  api.PREFIX = PREFIX;
  return api;
});
