import Proto from 'uberproto'
import { R, RTable, RValue, RQuery } from 'rethinkdb-ts/lib/types'
import {
  ServiceMethods,
  Params,
  PaginationOptions,
  Query
} from '@feathersjs/feathers'
import { _, select, hooks, filterQuery } from '@feathersjs/commons'
import errors from '@feathersjs/errors'

declare module '@feathersjs/feathers' {
  interface Params {
    rethinkdb?: RQuery
  }
}

import { createFilter } from './parse'

const { processHooks, getHooks, createHookObject } = hooks
const BASE_EVENTS = ['created', 'updated', 'patched', 'removed']

interface Options {
  r: R
  db: string
  name: string
  id?: string
  watch?: boolean
  paginate?: {}
  events?: string[]
}

// Create the service.
class Service<A> implements ServiceMethods<A> {
  type: 'rethinkdb'
  id: string
  table: RTable
  options: Options
  watch: boolean
  paginate: {}
  events: string[]
  constructor (options: Options) {
    if (!options) {
      throw new Error('RethinkDB options have to be provided.')
    }

    if (!options.r) {
      throw new Error('You must provide the RethinkDB object on options.Model')
    }

    if (!options.db) {
      throw new Error('You must provide a db name on options.db')
    }

    if (!options.name) {
      throw new Error('You must provide a table name on options.name')
    }

    this.type = 'rethinkdb'
    this.id = options.id || 'id'
    this.table = options.r.db(options.db).table(options.name)
    this.options = options
    this.watch = options.watch ?? true
    this.paginate = options.paginate ?? {}
    this.events = this.watch
      ? BASE_EVENTS.concat(options.events ?? [])
      : options.events ?? []
  }

  extend (obj: any) {
    return Proto.extend(obj, this)
  }

  async init (opts = {}) {
    let r = this.options.r
    let t = this.options.name
    let db = this.options.db

    await r
      .dbList()
      .contains(db) // create db if not exists
      .do((dbExists: RValue<boolean>) =>
        r.branch(dbExists, { created: 0 }, r.dbCreate(db))
      )
      .run()
    return r
      .db(db)
      .tableList()
      .contains(t) // create table if not exists
      .do((tableExists: RValue<boolean>) =>
        r.branch(tableExists, { created: 0 }, r.db(db).tableCreate(t, opts))
      )
      .run()
  }

  createFilter (query) {
    return createFilter(query, this.options.r)
  }

  createQuery (originalQuery) {
    const { filters, query } = filterQuery(originalQuery || {})

    let r = this.options.r
    let rq = this.table.filter(this.createFilter(query))

    // Handle $select
    if (filters.$select) {
      rq = rq.pluck(filters.$select)
    }

    // Handle $sort
    if (filters.$sort) {
      _.each(filters.$sort, (order, fieldName) => {
        if (parseInt(order) === 1) {
          rq = rq.orderBy(fieldName)
        } else {
          rq = rq.orderBy(r.desc(fieldName))
        }
      })
    }

    return rq
  }

  _find (params: Params = {}) {
    const paginate =
      typeof params.paginate !== 'undefined' ? params.paginate : this.paginate
    // Prepare the special query params.
    const { filters } = filterQuery(params.query || {}, paginate)

    let q = params.rethinkdb || this.createQuery(params.query)
    let countQuery

    // For pagination, count has to run as a separate query, but without limit.
    if (paginate.default) {
      countQuery = q.count().run()
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
    return Promise.all([q, countQuery]).then(([data, total]) => {
      if (paginate.default) {
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

  find (...args) {
    return this._find(...args)
  }

  _get (id, params = {}) {
    let query = this.table.filter(params.query).limit(1)

    // If an id was passed, just get the record.
    if (id !== null && id !== undefined) {
      query = this.table.get(id)
    }

    if (params.query && params.query.$select) {
      query = query.pluck(params.query.$select.concat(this.id))
    }

    return query.run().then(data => {
      if (Array.isArray(data)) {
        data = data[0]
      }
      if (!data) {
        throw new errors.NotFound(`No record found for id '${id}'`)
      }
      return data
    })
  }

  get (...args) {
    return this._get(...args)
  }

  create (data, params = {}) {
    const idField = this.id
    return this.table
      .insert(data, params.rethinkdb)
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
          const addId = (current, index) => {
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

  patch (id, data, params = {}) {
    let query

    if (id !== null && id !== undefined) {
      query = this._get(id)
    } else if (params) {
      query = this._find(params)
    } else {
      return Promise.reject(new Error('Patch requires an ID or params'))
    }

    // Find the original record(s), first, then patch them.
    return query
      .then(getData => {
        let query
        let options = Object.assign({ returnChanges: true }, params.rethinkdb)

        if (Array.isArray(getData)) {
          query = this.table.getAll(...getData.map(item => item[this.id]))
        } else {
          query = this.table.get(id)
        }

        return query
          .update(data, options)
          .run()
          .then(response => {
            let changes = response.changes.map(change => change.new_val)
            return changes.length === 1 ? changes[0] : changes
          })
      })
      .then(select(params, this.id))
  }

  update (id, data, params = {}) {
    let options = Object.assign({ returnChanges: true }, params.rethinkdb)

    if (Array.isArray(data) || id === null) {
      return Promise.reject(
        new errors.BadRequest(
          'Not replacing multiple records. Did you mean `patch`?'
        )
      )
    }

    return this._get(id, params)
      .then(getData => {
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

  remove (id: string, params = {}) {
    let query
    let options = Object.assign({ returnChanges: true }, params.rethinkdb)

    // You have to pass id=null to remove all records.
    if (id !== null && id !== undefined) {
      query = this.table.get(id)
    } else if (id === null) {
      query = this.createQuery(params.query)
    } else {
      return Promise.reject(
        new Error('You must pass either an id or params to remove.')
      )
    }

    return query
      .delete(options)
      .run()
      .then(res => {
        if (res.changes && res.changes.length) {
          let changes = res.changes.map(change => change.old_val)
          return changes.length === 1 ? changes[0] : changes
        } else {
          return []
        }
      })
      .then(select(params, this.id))
  }

  watchChangefeeds (app) {
    if (!this.watch || this._cursor) {
      return this._cursor
    }

    let runHooks = (method, data) =>
      Promise.resolve({
        result: data
      })

    if (this.__hooks) {
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
          type: 'after',
          get path () {
            return Object.keys(app.services).find(
              path => app.services[path] === service
            )
          }
        }

        // Add `data` to arguments
        if (method === 'create' || method === 'update' || method === 'patch') {
          args.unshift(data)
        }

        // `id` for update, patch and remove
        if (method === 'update' || method === 'patch' || method === 'remove') {
          args.unshift(data[this.id])
        }

        const hookObject = createHookObject(method, args, hookData)
        const hookChain = getHooks(app, this, 'after', method)

        return processHooks.call(this, hookChain, hookObject)
      }
    }

    this._cursor = this.table
      .changes()
      .run()
      .then(cursor => {
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

  setup (app) {
    const rethinkInit = app.get('rethinkInit') || Promise.resolve()

    rethinkInit.then(() => this.watchChangefeeds(app))
  }
}

module.exports = function (options) {
  return new Service(options)
}

module.exports.Service = Service
