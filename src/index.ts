import {
  R,
  RTable,
  RValue,
  RDatum,
  RQuery,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  RCursor,
  Changes,
  RSelection,
  RSingleSelection,
  TableCreateOptions
} from 'rethinkdb-ts/lib/types'
import {
  Id,
  NullableId,
  ServiceMethods,
  Params as DefaultParams,
  PaginationOptions,
  Query,
  Application,
  Paginated,
  SetupMethod
} from '@feathersjs/feathers'
import { _, hooks } from '@feathersjs/commons'
import {
  AdapterService,
  select,
  ServiceOptions,
  InternalServiceMethods,
  filterQuery
} from '@feathersjs/adapter-commons'
import errors from '@feathersjs/errors'
import { EventEmitter } from 'events'
import { DeepPartial } from 'rethinkdb-ts/lib/internal-types'

//declare module '@feathersjs/feathers' {
interface Params extends DefaultParams {
  paginate?: false | PaginationOptions
}
//}

const { processHooks, getHooks, createHookObject } = hooks
const BASE_EVENTS = ['created', 'updated', 'patched', 'removed']

export interface Options extends ServiceOptions {
  Model: R
  db: string
  name: string
  watch?: boolean
  events: string[]
  paginate: false | PaginationOptions
  tableCreateOptions?: TableCreateOptions
}

// Create the service.
class Service<A> extends AdapterService<A>
  implements InternalServiceMethods, SetupMethod {
  type: 'rethinkdb'
  table: RTable<A>
  watch: boolean
  options: Options
  paginate: false | PaginationOptions
  _cursor: any
  constructor (options: Options) {
    if (!options) {
      throw new Error('RethinkDB options have to be provided.')
    }

    if (!options.Model) {
      throw new Error('You must provide the RethinkDB object on options.Model')
    }

    if (!options.db) {
      throw new Error('You must provide a db name on options.db')
    }

    if (!options.name) {
      throw new Error('You must provide a table name on options.name')
    }
    if (options.watch) {
      options.events = BASE_EVENTS.concat(options.events ?? [])
    }
    super({ id: '_id', ...options })
    this.options = Object.assign(
      // we need to do this again, just for correct typings
      {
        id: 'id',
        events: [],
        paginate: {},
        multi: false,
        filters: [],
        whitelist: []
      },
      options
    )

    this.type = 'rethinkdb'
    this.table = options.Model.db(options.db).table(options.name)
    this.watch = options.watch ?? true
    this.paginate = options.paginate
  }

  get Model () {
    return this.options.Model
  }
  set Model (value: R) {
    this.options.Model = value
  }

  _multiOptions (id: Id, params: Params = {}) {
    const { query } = this.filterQuery(params)
    const options = Object.assign(
      { multi: true },
      params.rethinkdb || params.options
    )

    if (id !== null) {
      options.multi = false
      query.$and = (query.$and || []).concat({
        [this.id]: id
      })
    }

    return { query, options }
  }

  /*filterQuery (q: any) {
    return super.filterQuery(q || {}, {
      operators: [...(this.options.whitelist || []), '$or']
    })
  }*/
  /*
  createQuery (q: any) {
    let r = this.options.Model

    const { filters, query: feathersQuery } = this.filterQuery(q)

    let query = this.table.filter(this.createFilter(feathersQuery))

    // Handle $select
    if (filters.$select) {
      query = query.pluck(filters.$select) as any
    }

    // Handle $sort
    if (filters.$sort) {
      _.each(filters.$sort, (order, fieldName) => {
        if (parseInt(order) === 1) {
          query = query.orderBy(fieldName)
        } else {
          query = query.orderBy(r.desc(fieldName))
        }
      })
    }

    return { filters, query }
  }
  */

  parse (query: any): (doc: any) => RDatum<any> {
    const r = this.options.Model
    return doc => {
      const or = query.$or
      const and = query.$and
      let matcher = r({})

      // Handle $or. If it exists, use the first $or entry as the base matcher
      if (Array.isArray(or)) {
        matcher = this.parse(or[0])(doc)

        for (let i = 0; i < or.length; i++) {
          matcher = matcher.or(this.parse(or[i])(doc))
        }
        // Handle $and
      } else if (Array.isArray(and)) {
        matcher = this.parse(and[0])(doc)

        for (let i = 0; i < and.length; i++) {
          matcher = matcher.and(this.parse(and[i])(doc))
        }
      }

      _.each(query, (value, field) => {
        if (typeof value !== 'object') {
          // Match value directly
          matcher = matcher.and(buildNestedQueryPredicate(field, doc).eq(value))
        } else {
          // Handle special parameters
          _.each(value, (selector, type) => {
            let method
            if (type === '$in') {
              matcher = matcher.and(
                r.expr(selector).contains(buildNestedQueryPredicate(field, doc))
              )
            } else if (type === '$nin') {
              matcher = matcher.and(
                r
                  .expr(selector)
                  .contains(buildNestedQueryPredicate(field, doc))
                  .not()
              )
            } else if ((method = mappings[type])) {
              const selectorArray = Array.isArray(selector)
                ? selector
                : [selector]

              matcher = matcher.and(
                buildNestedQueryPredicate(field, doc)[method](...selectorArray)
              )
            }
          })
        }
      })

      return matcher
    }
  }

  _find (params: Params & { paginate: false }): Promise<A[]>
  _find (params: Params & { paginate: true }): Promise<Paginated<A>>
  _find (params: Params): Promise<A[] | Paginated<A>>
  _find (params: Params) {
    const { filters, query, paginate } = this.filterQuery(params)
    // Prepare the special query params.

    let r = this.options.Model
    let q = this.table.filter(this.parse(query))

    // Handle $select
    if (filters.$select) {
      q = q.pluck(filters.$select) as any
    }

    // Handle $sort
    if (filters.$sort) {
      _.each(filters.$sort, (order, fieldName) => {
        if (parseInt(order) === 1) {
          q = q.orderBy(fieldName)
        } else {
          q = q.orderBy(r.desc(fieldName))
        }
      })
    }
    let countQuery

    // For pagination, count has to run as a separate query, but without limit.
    if (paginate && paginate.default) {
      countQuery = q.count()
    }

    // Handle $skip AFTER the count query but BEFORE $limit.
    if (filters.$skip) {
      q = q.skip(filters.$skip)
    }
    // Handle $limit AFTER the count query and $skip.
    if (typeof filters.$limit !== 'undefined') {
      q = q.limit(filters.$limit)
    }

    // Execute the query
    return Promise.all([q.run(), countQuery?.run()]).then(([data, total]) => {
      if (paginate && paginate.default) {
        return {
          total,
          data,
          limit: filters.$limit,
          skip: filters.$skip || 0
        }
      }

      return data
    })
  }

  _get (id: Id, params: Params & { query?: any }) {
    const { query } = this.filterQuery(params)
    const q = this.table.filter(doc =>
      this.parse(query)(doc).and(doc(this.id).eq(id))
    )
    return q
      .run()
      .then(data => {
        const result = Array.isArray(data) ? data[0] : data
        if (!result) {
          throw new errors.NotFound(`No record found for id '${id}'`)
        }
        return result
      })
      .then(select(params, this.id))
  }

  async _findOrGet (id: Id, params = {}): Promise<A | A[]> {
    if (id === null) {
      return this._find(
        _.extend({}, params, {
          paginate: false
        })
      )
    }

    return this._get(id, params)
  }

  _create (data: any, params: Params & { rethinkdb?: InsertOptions }) {
    const idField = this.id
    return this.table
      .insert(data, ...(params.rethinkdb ? [params.rethinkdb] : []))
      .run()
      .then(res => {
        if (data[idField]) {
          if (res.errors) {
            return Promise.reject(
              new errors.Conflict('Duplicate primary key', res.errors)
            )
          }
          return data
        } else {
          // add generated id
          const addId = (current: any, index: number) => {
            if (res.generated_keys && res.generated_keys[index]) {
              return Object.assign({}, current, {
                [idField]: res.generated_keys[index]
              })
            }

            return current
          }

          if (Array.isArray(data)) {
            return data.map(addId)
          }

          return addId(data, 0)
        }
      })
      .then(select(params, this.id))
  }

  _patch (id: Id, data: any, params: Params & { rethinkdb?: UpdateOptions }) {
    let { query } = this._multiOptions(id, params)
    if (id === undefined && !params) {
      return Promise.reject(new Error('Patch requires an ID or params'))
    }

    // Find the original record(s), first, then patch them.
    const docs = this._findOrGet(id, params)

    return docs
      .then((result: any) => {
        let q
        let options = Object.assign({ returnChanges: true }, params.rethinkdb)

        if (Array.isArray(result)) {
          if (id !== null && id !== undefined && !result.length) {
            throw new errors.NotFound('Could not find document')
          }
          q = this.table.getAll(...result.map(item => item[this.id]))
        } else {
          q = this.table.get(id)
        }

        return q
          .update(data, options)
          .run()
          .then(response => {
            let changes = (response.changes ?? []).map(change => change.new_val)
            return changes.length === 1 ? changes[0] : changes
          })
      })
      .then(select(params, this.id))
  }

  _update (id: Id, data: any, params: { rethinkdb?: UpdateOptions }) {
    let options = Object.assign({ returnChanges: true }, params.rethinkdb)

    if (Array.isArray(data) || id === null) {
      return Promise.reject(
        new errors.BadRequest(
          'Not replacing multiple records. Did you mean `patch`?'
        )
      )
    }

    return this._get(id, params)
      .then((getData: any) => {
        data[this.id] = id
        return this.table
          .get(getData[this.id])
          .replace(data, options)
          .run()
          .then(result =>
            result.changes && result.changes.length
              ? result.changes[0].new_val
              : data
          )
      })
      .then(select(params, this.id))
  }

  _remove (id: string, params: Params & { rethinkdb?: DeleteOptions }) {
    let { query } = this._multiOptions(id, params)

    let options = Object.assign({ returnChanges: true }, params.rethinkdb ?? {})

    if (id === undefined) {
      return Promise.reject(
        new Error(
          'You must pass either an id or params to remove. You have to pass id=null to remove all records.'
        )
      )
    }
    const docs = this.table.filter(this.parse(query))

    return docs
      .delete(options)
      .run()
      .then(res => {
        if (res.changes && res.changes.length) {
          let changes = res.changes.map(change => change.old_val)
          return changes.length === 1 ? changes[0] : changes
        } else {
          if (id !== null && id !== undefined) {
            throw new errors.NotFound('Could not find document to remove')
          }
          return []
        }
      })
      .then(select(params, this.id))
  }

  watchChangefeeds (this: Service<A> & EventEmitter, app: Application) {
    if (!this.watch || this._cursor) {
      return this._cursor
    }

    let runHooks = (method: string, data: any) =>
      Promise.resolve({
        result: data
      })

    if ((this as any).__hooks) {
      // If the hooks plugin is enabled
      // This is necessary because the data coming directly from the
      // change feeds does not run through `after` hooks by default
      // so we have to do it manually
      runHooks = (method, data) => {
        const service = this
        const args = [{ query: {} }]
        const hookData = {
          app,
          service,
          result: data,
          id:
            method === 'update' || method === 'patch' || method === 'remove'
              ? data[this.id]
              : undefined,
          type: 'after',
          get path () {
            return Object.keys(app.services).find(
              path => app.services[path] === service
            )
          }
        }

        const hookObject = createHookObject(method, hookData)
        const hookChain = getHooks(app, this, 'after', method)

        return processHooks.call(this, hookChain, hookObject)
      }
    }

    this._cursor = this.table
      .changes()
      .run()
      .then((cursor: RCursor<Changes<any>>) => {
        cursor.each((error, data) => {
          if (error || typeof this.emit !== 'function') {
            return
          }
          // For each case, run through processHooks first,
          // then emit the event
          if (data.old_val === null) {
            runHooks('create', data.new_val).then(hook =>
              this.emit('created', hook.result)
            )
          } else if (data.new_val === null) {
            runHooks('remove', data.old_val).then(hook =>
              this.emit('removed', hook.result)
            )
          } else {
            runHooks('patch', data.new_val).then(hook => {
              this.emit('updated', hook.result)
              this.emit('patched', hook.result)
            })
          }
        })

        return cursor
      })

    return this._cursor
  }

  async setup (this: Service<A> & EventEmitter, app: Application) {
    await app.get('rethinkInit')

    let r = this.options.Model
    let t = this.options.name
    let db = this.options.db
    const opts = this.options.tableCreateOptions

    await r
      .dbList()
      .contains(db) // create db if not exists
      .do((dbExists: RValue<boolean>) =>
        r.branch(dbExists, { created: 0 }, r.dbCreate(db))
      )
      .run()
    await r
      .db(db)
      .tableList()
      .contains(t) // create table if not exists
      .do((tableExists: RValue<boolean>) =>
        r.branch(
          tableExists,
          { created: 0 },
          r.db(db).tableCreate(t, ...(opts ? [opts] : []))
        )
      )
      .run()
    this.watchChangefeeds(app)
  }
}

// Special parameter to RQL condition
const mappings: { [key: string]: string | undefined } = {
  $search: 'match',
  $contains: 'contains',
  $lt: 'lt',
  $lte: 'le',
  $gt: 'gt',
  $gte: 'ge',
  $ne: 'ne',
  $eq: 'eq'
}
function buildNestedQueryPredicate (field: string, doc: any) {
  var fields = field.split('.')
  var searchFunction = doc(fields[0])

  for (var i = 1; i < fields.length; i++) {
    searchFunction = searchFunction(fields[i])
  }

  return searchFunction
}

export default function (options: Options) {
  return new Service(options)
}

export { Service }
