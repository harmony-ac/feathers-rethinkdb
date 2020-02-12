# feathers-rethinkdb

> __WORK IN PROGRESS__ This is a fork of the feathers-rethinkdb project, which is no longer maintained. This code is a WIP upgrade to the latest Feathers db adapter standards. It already passes the common db tests. If interested, contact @cie.

[![Greenkeeper badge](https://badges.greenkeeper.io/feathersjs-ecosystem/feathers-rethinkdb.svg)](https://greenkeeper.io/)

[![Build Status](https://travis-ci.org/feathersjs-ecosystem/feathers-rethinkdb.png?branch=master)](https://travis-ci.org/feathersjs-ecosystem/feathers-rethinkdb)
[![Dependency Status](https://img.shields.io/david/feathersjs-ecosystem/feathers-rethinkdb.svg?style=flat-square)](https://david-dm.org/feathersjs-ecosystem/feathers-rethinkdb)
[![Download Status](https://img.shields.io/npm/dm/feathers-rethinkdb.svg?style=flat-square)](https://www.npmjs.com/package/feathers-rethinkdb)

[feathers-rethinkdb](https://github.com/feathersjs-ecosystem/feathers-rethinkdb) is a database adapter for [RethinkDB](https://rethinkdb.com), a real-time database.

```bash
$ npm install --save rethinkdbdash feathers-rethinkdb
```

> __Important:__ `feathers-rethinkdb` implements the [Feathers Common database adapter API](https://docs.feathersjs.com/api/databases/common.html) and [querying syntax](https://docs.feathersjs.com/api/databases/querying.html).

> This adapter requires a running [RethinkDB](https://www.rethinkdb.com/) server.

## API

### `service(options)`

Returns a new service instance initialized with the given options. For more information on initializing the driver see the [RethinkDBdash documentation](https://github.com/neumino/rethinkdbdash).

```js
const r = require('rethinkdbdash')({
  db: 'feathers'
});
const service = require('feathers-rethinkdb');

app.use('/messages', service({
  Model: r,
  db: 'someotherdb', //must be on the same connection as rethinkdbdash
  name: 'messages',
  // Enable pagination
  paginate: {
    default: 2,
    max: 4
  }
}));
```

> **Note:** By default, `watch` is set to `true` which means this adapter monitors the database for changes and automatically sends real-time events. This means that, unlike other databases and services, you will also get events if the database is changed directly.

__Options:__

- `Model` (**required**) - The `rethinkdbdash` instance, already initialized with a configuration object. [see options here](https://github.com/neumino/rethinkdbdash#importing-the-driver)
- `name` (**required**) - The name of the table
- `watch` (*optional*, default: `true`) - Listen to table changefeeds and send according [real-time events](https://docs.feathersjs.com/api/events.html) on the adapter.
- `db` (*optional*, default: `none`) - Specify and alternate rethink database for the service to use. Must be on the same server/connection used by rethinkdbdash. It will be auto created if you call init() on the service and it does not yet exist.
- `id` (*optional*, default: `'id'`) - The name of the id field property. Needs to be set as the primary key when creating the table.
- `events` (*optional*) - A list of [custom service events](https://docs.feathersjs.com/api/events.html#custom-events) sent by this service
- `paginate` (*optional*) - A [pagination object](https://docs.feathersjs.com/api/databases/common.html#pagination) containing a `default` and `max` page size

### `adapter.init([options])`

Create the database and table if it does not exists. `options` can be the RethinkDB [tableCreate options](https://rethinkdb.com/api/javascript/table_create/).

```js
// Initialize the `messages` table with `messageId` as the primary key
app.service('messages').init({
  primaryKey: 'messageId'
}).then(() => {
  // Use service here
});
```

### `adapter.createQuery(query)`

Returns a RethinkDB query with the [common filter criteria](https://docs.feathersjs.com/api/databases/querying.html) (without pagination) applied.

### params.rethinkdb

When making a [service method](https://docs.feathersjs.com/api/services.html) call, `params` can contain an `rethinkdb` property which allows to pass additional RethinkDB options. See [customizing the query](#customizing-the-query) for an example.


## Example

To run the complete RethinkDB example we need to install

```
$ npm install @feathersjs/feathers @feathersjs/errors @feathersjs/express @feathersjs/socketio feathers-rethinkdb rethinkdbdash
```

We also need access to a RethinkDB server. You can install a local server on your local development machine by downloading one of the packages [from the RethinkDB website](https://rethinkdb.com/docs/install/). It might also be helpful to review their docs on [starting a RethinkDB server](http://rethinkdb.com/docs/start-a-server/).

Then add the following into `app.js`:

```js
const feathers = require('@feathersjs/feathers');
const express = require('@feathersjs/express');
const socketio = require('@feathersjs/socketio');

const rethink = require('rethinkdbdash');
const service = require('feathers-rethinkdb');

// Connect to a local RethinkDB server.
const r = rethink({
  db: 'feathers'
});

// Create an Express compatible Feathers applicaiton instance.
const app = express(feathers());

// Turn on JSON parser for REST services
app.use(express.json());
// Turn on URL-encoded parser for REST services
app.use(express.urlencoded({extended: true}));
// Enable the REST provider for services.
app.configure(express.rest());
// Enable the socketio provider for services.
app.configure(socketio());
// Register the service
app.use('messages', service({
  Model: r,
  name: 'messages',
  paginate: {
    default: 10,
    max: 50
  }
}));
app.use(express.errorHandler());

// Initialize database and messages table if it does not exists yet
app.service('messages').init().then(() => {
  // Create a message on the server
  app.service('messages').create({
    text: 'Message created on server'
  }).then(message => console.log('Created message', message));

  const port = 3030;
  app.listen(port, function() {
    console.log(`Feathers server listening on port ${port}`);
  });
});
```

Run the example with `node app` and go to [localhost:3030/messages](http://localhost:3030/messages).


## Querying

In addition to the [common querying mechanism](https://docs.feathersjs.com/api/databases/querying.html), this adapter also supports:

### `$search`

Return all matches for a property using the [RethinkDB match syntax](https://www.rethinkdb.com/api/javascript/match/).

```js
// Find all messages starting with Hello
app.service('messages').find({
  query: {
    text: {
      $search: '^Hello'
    }
  }
});

// Find all messages ending with !
app.service('messages').find({
  query: {
    text: {
      $search: '!$'
    }
  }
});
```

```
GET /messages?text[$search]=^Hello
GET /messages?text[$search]=!$
```

### `$contains`

Matches if the property is an array that contains the given entry.


```js
// Find all messages tagged with `nodejs`
app.service('messages').find({
  query: {
    tags: {
      $contains: 'nodejs'
    }
  }
});
```

```
GET /messages?tags[$contains]=nodejs
```

### Nested Queries

Matches if the document contains a nested property that fits the query

Given the following document structure
```js
app.service('people').create([{
    name: 'Dave',
    postalAddress: {
      city: 'Melbourne',
      country: 'US',
      state: 'FL',
      street: '123 6th St',
      zipcode: '32904'
    }
  }, {
    name: 'Tom',
    postalAddress: {
      city: 'Chevy Chase',
      country: 'US',
      state: 'MD',
      street: '71 Pilgrim Avenue',
      zipcode: '20815'
    }
  }, {
    name: 'Eric',
    postalAddress: {
      city: 'Honolulu',
      country: 'US',
      state: 'HI',
      street: '4 Goldfield St',
      zipcode: '96815'
    }
  }])
```

```js
// Find all people with postalAddress.state that starts with `F`
app.service('people').find({
  query: {
    'postalAddress.state': {
      $search: '^F'
      }
    }
  }
});
```

```
GET /people?postalAddress.state[$search]=^F
```

## Customizing the query

In a `find` call, `params.rethinkdb` can be passed a RethinkDB query (without pagination) to customize the find results.

Combined with `.createQuery(query)`, which returns a new RethinkDB query with the [common filter criteria](https://docs.feathersjs.com/api/databases/querying.html) applied, this can be used to create more complex queries. The best way to customize the query is in a [before hook](https://docs.feathersjs.com/api/hooks.html) for `find`. The following example adds a `coerceTo`condition from [RethinkDB coerceTo API](https://www.rethinkdb.com/api/javascript/#coerce_to) to match by any string inside an object.

```js
app.service('mesages').hooks({
  before: {
    find(context) {
      const query = context.service.createQuery(context.params.query);
      
      const searchString = "my search string";
      
      hook.params.rethinkdb = query.filter(function(doc) {
        return doc.coerceTo('string').match('(?i)' + searchString);
      })
    }
  }
});
```

If you need even more control then you can use `service.table` (`context.service.table` in a hook) directly. This way you can create a query from scratch without the the [common filter criteria](https://docs.feathersjs.com/api/databases/querying.html) applied. The following example adds a `getNearest` condition for [RethinkDB geospatial queries](https://www.rethinkdb.com/docs/geo-support/javascript/).

```js
app.service('mesages').hooks({
  before: {
    find(context) {
      const r = this.options.r;

      const point = r.point(-122.422876, 37.777128);  // San Francisco

      // Replace the query with a custom query
      context.params.rethinkdb = context.service.table.getNearest(point, { index: 'location' });
    }
  }
});
```

## Changefeeds

`.createQuery(query)` can also be used to listen to changefeeds and then send [custom events](https://docs.feathersjs.com/api/events.html).

Since the service already sends real-time events for all changes the recommended way to listen to changes is with [feathers-reactive](https://github.com/feathersjs/feathers-reactive) however.

## License

Copyright (c) 2017

Licensed under the [MIT license](LICENSE).
