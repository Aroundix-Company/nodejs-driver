'use strict';
var assert = require('assert');
var DseGssAuthProvider = require('../../lib/auth/dse-gss-auth-provider');

var dseAuthenticatorName = 'com.datastax.bdp.cassandra.auth.DseAuthenticator';

describe('DseGssAuthProvider', function () {
  describe('constructor', function () {
    it('should load optional kerberos module', function () {
      var authProvider = new DseGssAuthProvider();
      assert.ok(authProvider._kerberos);
    });
  });
  describe('#newAuthenticator()', function () {
  });
});
describe('GssAuthenticator', function () {
  describe('#initialResponse()', function () {
    it('should send mechanism and call client.init()', function (done) {
      var authProvider = new DseGssAuthProvider();
      var authenticator = authProvider.newAuthenticator('127.0.0.1:1001', dseAuthenticatorName);
      var initCalled = 0;
      authenticator.client = {
        init: function (cb) {
          initCalled++;
          cb();
        }
      };
      authenticator.initialResponse(function (err, response) {
        assert.ifError(err);
        assert.ok(response);
        assert.strictEqual(response.toString(), 'GSSAPI');
        assert.strictEqual(initCalled, 1);
        done();
      });
    });
    it('should call evaluateChallenge() when DSE lower than v5', function (done) {
      var authProvider = new DseGssAuthProvider();
      var authenticator = authProvider.newAuthenticator('127.0.0.1:1001', 'DSE4');
      var evaluateChallengeCalled = 0;
      authenticator.client = {
        init: function (cb) {
          cb();
        }
      };
      authenticator.evaluateChallenge = function (challenge, cb) {
        evaluateChallengeCalled++;
        cb(null, 'EVALUATED');
      };
      authenticator.initialResponse(function (err, response) {
        assert.ifError(err);
        assert.strictEqual(response, 'EVALUATED');
        assert.strictEqual(evaluateChallengeCalled, 1);
        done();
      });
    });
  });
  describe('#evaluateChallenge()', function () {
    it('should call client.evaluateChallenge()');
  });
});