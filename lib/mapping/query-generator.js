/*
 * Copyright DataStax, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

const vm = require("vm");
const qModule = require("./q");
const QueryOperator = qModule.QueryOperator;
const QueryAssignment = qModule.QueryAssignment;
const types = require("../types");
const dataTypes = types.dataTypes;

const vmFileName = "gen-param-getter.js";

/**
 * Provides methods to generate a query and parameter handlers.
 * @ignore
 */
class QueryGenerator {
  /**
   * Gets the SELECT query given the doc.
   * @param {String} tableName
   * @param {String} keyspace
   * @param {Array} propertiesInfo
   * @param {Array} fieldsInfo
   * @param {Array} orderByColumns
   * @param {Boolean} allowFilter
   * @param {Number|undefined} limit
   * @return {string}
   */
  static getSelect(
    tableName,
    keyspace,
    propertiesInfo,
    fieldsInfo,
    orderByColumns,
    allowFilter,
    limit
  ) {
    let query = "SELECT ";
    query +=
      fieldsInfo.length > 0
        ? fieldsInfo.map((p) => p.columnName).join(", ")
        : "*";
    query += ` FROM ${keyspace}.${tableName}`;

    if (propertiesInfo.length > 0) {
      query += " WHERE ";
      query += QueryGenerator._getConditionWithOperators(propertiesInfo);
    }

    if (orderByColumns.length > 0) {
      query += " ORDER BY ";
      query += orderByColumns
        .map((order) => order[0] + " " + order[1])
        .join(", ");
    }

    if (typeof limit === "number") {
      query += " LIMIT ?";
    }

    return query + " ALLOW FILTERING";
  }

  static selectParamsGetter(propertiesInfo, limit) {
    let scriptText =
      "(function getParametersSelect(doc, docInfo, mappingInfo) {\n";
    scriptText += "  return [";

    scriptText += QueryGenerator._valueGetterExpression(propertiesInfo);

    if (typeof limit === "number") {
      if (propertiesInfo.length > 0) {
        scriptText += ", ";
      }
      scriptText += `docInfo['limit']`;
    }

    // Finish return statement
    scriptText += "];\n})";

    const script = new vm.Script(scriptText, { filename: vmFileName });
    return script.runInThisContext();
  }

  /**
   * Gets the INSERT query and function to obtain the parameters, given the doc.
   * @param {TableMetadata} table
   * @param {String} keyspace
   * @param {Array} propertiesInfo
   * @param {Object} docInfo
   * @param {Boolean|undefined} ifNotExists
   * @param {Boolean} allowFilter
   * @return {{query: String, paramsGetter: Function, isIdempotent: Boolean}}
   */
  static getInsert(
    table,
    keyspace,
    propertiesInfo,
    docInfo,
    ifNotExists,
    allowFilter
  ) {
    const ttl = docInfo && docInfo.ttl;

    // Not all columns are contained in the table
    const filteredPropertiesInfo = propertiesInfo.filter(
      (pInfo) => table.columnsByName[pInfo.columnName] !== undefined
    );

    return {
      query: QueryGenerator._getInsertQuery(
        table.name,
        keyspace,
        filteredPropertiesInfo,
        ifNotExists,
        ttl,
        allowFilter
      ),
      paramsGetter: QueryGenerator._insertParamsGetter(
        filteredPropertiesInfo,
        docInfo
      ),
      isIdempotent: !ifNotExists,
    };
  }

  /**
   * Gets the query for an insert statement.
   * @param {String} tableName
   * @param {String} keyspace
   * @param {Array} propertiesInfo
   * @param {Boolean} ifNotExists
   * @param {Boolean} allowFilter
   * @param {Number|undefined} ttl
   * @return {String}
   */
  static _getInsertQuery(
    tableName,
    keyspace,
    propertiesInfo,
    ifNotExists,
    ttl,
    allowFilter
  ) {
    let query = `INSERT INTO ${keyspace}.${tableName} (`;
    query += propertiesInfo.map((pInfo) => pInfo.columnName).join(", ");
    query += ") VALUES (";
    query += propertiesInfo.map(() => "?").join(", ");
    query += ")";

    if (ifNotExists === true) {
      query += " IF NOT EXISTS";
    }

    if (typeof ttl === "number") {
      query += " USING TTL ?";
    }
    return query;
  }

  static _insertParamsGetter(propertiesInfo, docInfo) {
    let scriptText =
      "(function getParametersInsert(doc, docInfo, mappingInfo) {\n";
    scriptText += "  return [";

    scriptText += QueryGenerator._valueGetterExpression(propertiesInfo);

    if (docInfo && typeof docInfo.ttl === "number") {
      scriptText += `, docInfo['ttl']`;
    }

    // Finish return statement
    scriptText += "];\n})";

    const script = new vm.Script(scriptText, { filename: vmFileName });
    return script.runInThisContext();
  }

  /**
   * Gets the UPDATE query and function to obtain the parameters, given the doc.
   * @param {TableMetadata} table
   * @param {String} keyspace
   * @param {Array} propertiesInfo
   * @param {Object} docInfo
   * @param {Array} when
   * @param {Boolean|undefined} ifExists
   * @param {Boolean} allowFilter
   * @return {{query: String, paramsGetter: Function, isIdempotent: Boolean, isCounter}}
   */
  static getUpdate(
    table,
    keyspace,
    propertiesInfo,
    docInfo,
    when,
    ifExists,
    allowFilter
  ) {
    const ttl = docInfo && docInfo.ttl;
    const primaryKeys = new Set(
      table.partitionKeys.concat(table.clusteringKeys).map((c) => c.name)
    );
    let isIdempotent = true;
    let isCounter = false;

    // Not all columns are contained in the table
    const filteredPropertiesInfo = propertiesInfo.filter((pInfo) => {
      const column = table.columnsByName[pInfo.columnName];
      if (column === undefined) {
        return false;
      }

      if (
        column.type.code === dataTypes.list &&
        pInfo.value instanceof QueryAssignment
      ) {
        // Its not idempotent when list append/prepend
        isIdempotent = false;
      } else if (column.type.code === dataTypes.counter) {
        // Any update on a counter table is not idempotent
        isIdempotent = false;
        isCounter = true;
      }

      return true;
    });

    return {
      query: QueryGenerator._getUpdateQuery(
        table.name,
        keyspace,
        primaryKeys,
        filteredPropertiesInfo,
        when,
        ifExists,
        ttl,
        allowFilter
      ),
      isIdempotent: isIdempotent && when.length === 0 && !ifExists,
      paramsGetter: QueryGenerator._updateParamsGetter(
        primaryKeys,
        filteredPropertiesInfo,
        when,
        ttl
      ),
      isCounter,
    };
  }

  /**
   * Gets the query for an UPDATE statement.
   * @param {String} tableName
   * @param {String} keyspace
   * @param {Set} primaryKeys
   * @param {Array} propertiesInfo
   * @param {Object} when
   * @param {Boolean} ifExists
   * @param {Boolean} allowFilter
   * @param {Number|undefined} ttl
   */
  static _getUpdateQuery(
    tableName,
    keyspace,
    primaryKeys,
    propertiesInfo,
    when,
    ifExists,
    allowFilter,
    ttl
  ) {
    let query = `UPDATE ${keyspace}.${tableName} `;

    if (typeof ttl === "number") {
      query += "USING TTL ? ";
    }

    query += "SET ";

    query += propertiesInfo
      .filter((p) => !primaryKeys.has(p.columnName))
      .map((p) => {
        if (p.value instanceof QueryAssignment) {
          if (p.value.inverted) {
            // e.g: prepend "col1 = ? + col1"
            return `${p.columnName} = ? ${p.value.sign} ${p.columnName}`;
          }
          // e.g: increment "col1 = col1 + ?"
          return `${p.columnName} = ${p.columnName} ${p.value.sign} ?`;
        }

        return p.columnName + " = ?";
      })
      .join(", ");

    query += " WHERE ";
    query += propertiesInfo
      .filter((p) => primaryKeys.has(p.columnName))
      .map((p) => p.columnName + " = ?")
      .join(" AND ");

    if (ifExists === true) {
      query += " IF EXISTS";
    } else if (when.length > 0) {
      query += " IF " + QueryGenerator._getConditionWithOperators(when);
    }

    return query;
  }

  /**
   * Returns a function to obtain the parameter values from a doc for an UPDATE statement.
   * @param {Set} primaryKeys
   * @param {Array} propertiesInfo
   * @param {Array} when
   * @param {Number|undefined} ttl
   * @returns {Function}
   */
  static _updateParamsGetter(primaryKeys, propertiesInfo, when, ttl) {
    let scriptText =
      "(function getParametersUpdate(doc, docInfo, mappingInfo) {\n";
    scriptText += "  return [";

    if (typeof ttl === "number") {
      scriptText += `docInfo['ttl'], `;
    }

    // Assignment clause
    scriptText += QueryGenerator._assignmentGetterExpression(
      propertiesInfo.filter((p) => !primaryKeys.has(p.columnName))
    );
    scriptText += ", ";

    // Where clause
    scriptText += QueryGenerator._valueGetterExpression(
      propertiesInfo.filter((p) => primaryKeys.has(p.columnName))
    );

    // Condition clause
    if (when.length > 0) {
      scriptText +=
        ", " + QueryGenerator._valueGetterExpression(when, "docInfo.when");
    }

    // Finish return statement
    scriptText += "];\n})";

    const script = new vm.Script(scriptText, { filename: vmFileName });
    return script.runInThisContext();
  }

  /**
   * Gets the DELETE query and function to obtain the parameters, given the doc.
   * @param {TableMetadata} table
   * @param {String} keyspace
   * @param {Array} propertiesInfo
   * @param {Object} docInfo
   * @param {Array} when
   * @param {Boolean|undefined} ifExists
   * @return {{query: String, paramsGetter: Function, isIdempotent}}
   */
  static getDelete(table, keyspace, propertiesInfo, docInfo, when, ifExists) {
    const deleteOnlyColumns = docInfo && docInfo.deleteOnlyColumns;
    const primaryKeys = new Set(
      table.partitionKeys.concat(table.clusteringKeys).map((c) => c.name)
    );

    const filteredPropertiesInfo = propertiesInfo.filter(
      (pInfo) => table.columnsByName[pInfo.columnName] !== undefined
    );

    return {
      query: QueryGenerator._getDeleteQuery(
        table.name,
        keyspace,
        primaryKeys,
        filteredPropertiesInfo,
        when,
        ifExists,
        deleteOnlyColumns
      ),
      paramsGetter: QueryGenerator._deleteParamsGetter(
        primaryKeys,
        filteredPropertiesInfo,
        when
      ),
      isIdempotent: when.length === 0 && !ifExists,
    };
  }

  /**
   * Gets the query for an UPDATE statement.
   * @param {String} tableName
   * @param {String} keyspace
   * @param {Set} primaryKeys
   * @param {Array} propertiesInfo
   * @param {Array} when
   * @param {Boolean} ifExists
   * @param {Boolean} deleteOnlyColumns
   * @private
   * @return {String}
   */
  static _getDeleteQuery(
    tableName,
    keyspace,
    primaryKeys,
    propertiesInfo,
    when,
    ifExists,
    deleteOnlyColumns
  ) {
    let query = "DELETE";

    if (deleteOnlyColumns) {
      const columnsToDelete = propertiesInfo
        .filter((p) => !primaryKeys.has(p.columnName))
        .map((p) => p.columnName)
        .join(", ");

      if (columnsToDelete !== "") {
        query += " " + columnsToDelete;
      }
    }

    query += ` FROM ${keyspace}.${tableName} WHERE `;
    query += propertiesInfo
      .filter((p) => primaryKeys.has(p.columnName))
      .map((p) => p.columnName + " = ?")
      .join(" AND ");

    if (ifExists === true) {
      query += " IF EXISTS";
    } else if (when.length > 0) {
      query += " IF " + QueryGenerator._getConditionWithOperators(when);
    }

    return query;
  }
  /**
   * Returns a function to obtain the parameter values from a doc for an UPDATE statement.
   * @param {Set} primaryKeys
   * @param {Array} propertiesInfo
   * @param {Array} when
   * @returns {Function}
   */
  static _deleteParamsGetter(primaryKeys, propertiesInfo, when) {
    let scriptText =
      "(function getParametersDelete(doc, docInfo, mappingInfo) {\n";
    scriptText += "  return [";

    // Where clause
    scriptText += QueryGenerator._valueGetterExpression(
      propertiesInfo.filter((p) => primaryKeys.has(p.columnName))
    );

    // Condition clause
    if (when.length > 0) {
      scriptText +=
        ", " + QueryGenerator._valueGetterExpression(when, "docInfo.when");
    }

    // Finish return statement
    scriptText += "];\n})";

    const script = new vm.Script(scriptText, { filename: vmFileName });
    return script.runInThisContext();
  }

  /**
   * Gets a string containing the doc properties to get.
   * @param {Array} propertiesInfo
   * @param {String} [objectName='doc']
   * @return {string}
   * @private
   */
  static _valueGetterExpression(propertiesInfo, objectName) {
    objectName = objectName || "doc";

    return propertiesInfo
      .map((p) =>
        QueryGenerator._valueGetterSingle(
          `${objectName}['${p.propertyName}']`,
          p.propertyName,
          p.value,
          p.fromModel
        )
      )
      .join(", ");
  }

  static _valueGetterSingle(prefix, propName, value, fromModelFn) {
    let valueGetter = prefix;

    if (value instanceof QueryOperator) {
      if (value.hasChildValues) {
        return (
          `${QueryGenerator._valueGetterSingle(
            `${prefix}.value[0]`,
            propName,
            value.value[0],
            fromModelFn
          )}` +
          `, ${QueryGenerator._valueGetterSingle(
            `${prefix}.value[1]`,
            propName,
            value.value[1],
            fromModelFn
          )}`
        );
      }

      valueGetter = `${prefix}.value`;

      if (value.isInOperator && fromModelFn) {
        // Transform each individual value
        return `${valueGetter}.map(v => ${QueryGenerator._getMappingFunctionCall(
          propName,
          "v"
        )})`;
      }
    }

    return !fromModelFn
      ? valueGetter
      : QueryGenerator._getMappingFunctionCall(propName, valueGetter);
  }

  /**
   * Gets a string containing the doc properties to SET, considering QueryAssignment instances.
   * @param {Array} propertiesInfo
   * @param {String} [prefix='doc']
   * @return {string}
   * @private
   */
  static _assignmentGetterExpression(propertiesInfo, prefix) {
    prefix = prefix || "doc";

    return propertiesInfo
      .map((p) => {
        const valueGetter = `${prefix}['${p.propertyName}']${
          p.value instanceof QueryAssignment ? ".value" : ""
        }`;
        if (p.fromModel) {
          return QueryGenerator._getMappingFunctionCall(
            p.propertyName,
            valueGetter
          );
        }
        return valueGetter;
      })
      .join(", ");
  }

  static _getConditionWithOperators(propertiesInfo) {
    return propertiesInfo
      .map((p) => QueryGenerator._getSingleCondition(p.columnName, p.value))
      .join(" AND ");
  }

  static _getMappingFunctionCall(propName, valueGetter) {
    return `mappingInfo.getFromModelFn('${propName}')(${valueGetter})`;
  }

  static _getSingleCondition(columnName, value) {
    if (value instanceof QueryOperator) {
      if (value.hasChildValues) {
        return (
          `${QueryGenerator._getSingleCondition(columnName, value.value[0])}` +
          ` ${value.key} ${QueryGenerator._getSingleCondition(
            columnName,
            value.value[1]
          )}`
        );
      }
      return `${columnName} ${value.key} ?`;
    }
    return `${columnName} = ?`;
  }
}

module.exports = QueryGenerator;
