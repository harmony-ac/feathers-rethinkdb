"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lib_1 = require("@feathersjs/commons/lib");
// Special parameter to RQL condition
const mappings = {
    $search: 'match',
    $contains: 'contains',
    $lt: 'lt',
    $lte: 'le',
    $gt: 'gt',
    $gte: 'ge',
    $ne: 'ne',
    $eq: 'eq'
};
function createFilter(query, r) {
    return function (doc) {
        const or = query.$or;
        const and = query.$and;
        let matcher = r({});
        // Handle $or. If it exists, use the first $or entry as the base matcher
        if (Array.isArray(or)) {
            matcher = createFilter(or[0], r)(doc);
            for (let i = 0; i < or.length; i++) {
                matcher = matcher.or(createFilter(or[i], r)(doc));
            }
            // Handle $and
        }
        else if (Array.isArray(and)) {
            matcher = createFilter(and[0], r)(doc);
            for (let i = 0; i < and.length; i++) {
                matcher = matcher.and(createFilter(and[i], r)(doc));
            }
        }
        lib_1._.each(query, (value, field) => {
            if (typeof value !== 'object') {
                // Match value directly
                matcher = matcher.and(buildNestedQueryPredicate(field, doc).eq(value));
            }
            else {
                // Handle special parameters
                lib_1._.each(value, (selector, type) => {
                    let method;
                    if (type === '$in') {
                        matcher = matcher.and(r.expr(selector).contains(buildNestedQueryPredicate(field, doc)));
                    }
                    else if (type === '$nin') {
                        matcher = matcher.and(r
                            .expr(selector)
                            .contains(buildNestedQueryPredicate(field, doc))
                            .not());
                    }
                    else if ((method = mappings[type])) {
                        const selectorArray = Array.isArray(selector)
                            ? selector
                            : [selector];
                        matcher = matcher.and(buildNestedQueryPredicate(field, doc)[method](...selectorArray));
                    }
                });
            }
        });
        return matcher;
    };
}
exports.createFilter = createFilter;
function buildNestedQueryPredicate(field, doc) {
    var fields = field.split('.');
    var searchFunction = doc(fields[0]);
    for (var i = 1; i < fields.length; i++) {
        searchFunction = searchFunction(fields[i]);
    }
    return searchFunction;
}
