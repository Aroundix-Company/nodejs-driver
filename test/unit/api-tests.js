/**
 * Copyright DataStax, Inc.
 *
 * Please see the license for details:
 * http://www.datastax.com/terms/datastax-dse-driver-license-terms
 */
'use strict';
const assert = require('assert');
const api = require('../../index');
const auth = require('../../lib/auth');
const helper = require('../test-helper');

describe('API', function () {
  it('should expose auth module', function () {
    assert.ok(api.auth);
    assert.strictEqual(typeof api.auth.DsePlainTextAuthProvider, 'function');
    assert.ok(new api.auth.DsePlainTextAuthProvider('u', 'pass') instanceof auth.AuthProvider);
    if (helper.requireOptional('kerberos')) {
      assert.ok(new api.auth.DseGssapiAuthProvider() instanceof auth.AuthProvider);
    }
  });
  it('should expose geometry module', function () {
    assert.ok(api.geometry);
    checkConstructor(api.geometry, 'LineString');
    checkConstructor(api.geometry, 'Point');
    checkConstructor(api.geometry, 'Polygon');
  });
  it('should expose Client constructor', function () {
    checkConstructor(api, 'Client');
  });
  it('should expose GraphResultSet constructor', function () {
    checkConstructor(api.graph, 'GraphResultSet');
  });
  it('should expose graph types constructor', function () {
    checkConstructor(api.graph, 'Edge');
    checkConstructor(api.graph, 'Element');
    checkConstructor(api.graph, 'Path');
    checkConstructor(api.graph, 'Property');
    checkConstructor(api.graph, 'Vertex');
    checkConstructor(api.graph, 'VertexProperty');
  });
  it('should expose cassandra driver modules', function () {
    assert.ok(api.errors);
    assert.ok(api.policies);
    assert.ok(api.policies.loadBalancing);
    assert.ok(api.policies.retry);
    assert.ok(api.policies.reconnection);
    assert.ok(api.metadata);
    assert.ok(api.types);
    checkConstructor(api.types, 'BigDecimal');
    checkConstructor(api.types, 'Integer');
    checkConstructor(api.types, 'InetAddress');
    checkConstructor(api.types, 'Uuid');
    checkConstructor(api.types, 'TimeUuid');
  });
});

function checkConstructor(module, constructorName) {
  assert.strictEqual(typeof module[constructorName], 'function');
  // use Function.name
  assert.strictEqual(module[constructorName].name, constructorName);
}