/// <reference types="node" />
import { R, RTable, RDatum, InsertOptions, UpdateOptions, DeleteOptions, TableCreateOptions } from 'rethinkdb-ts/lib/types';
import { Id, Params as DefaultParams, PaginationOptions, Application, Paginated, SetupMethod } from '@feathersjs/feathers';
import { AdapterService, ServiceOptions, InternalServiceMethods } from '@feathersjs/adapter-commons';
import { EventEmitter } from 'events';
interface Params extends DefaultParams {
    paginate?: false | PaginationOptions;
}
interface Options extends ServiceOptions {
    Model: R;
    db: string;
    name: string;
    watch?: boolean;
    events: string[];
    paginate: false | PaginationOptions;
    tableCreateOptions?: TableCreateOptions;
}
declare class Service<A> extends AdapterService<A> implements InternalServiceMethods, SetupMethod {
    type: 'rethinkdb';
    table: RTable<A>;
    watch: boolean;
    options: Options;
    paginate: false | PaginationOptions;
    _cursor: any;
    constructor(options: Partial<Options>);
    get Model(): R;
    set Model(value: R);
    _multiOptions(id: Id, params?: Params): {
        query: any;
        options: any;
    };
    parse(query: any): (doc: any) => RDatum<any>;
    _find(params: Params & {
        paginate: false;
    }): Promise<A[]>;
    _find(params: Params & {
        paginate: true;
    }): Promise<Paginated<A>>;
    _find(params: Params): Promise<A[] | Paginated<A>>;
    _get(id: Id, params: Params & {
        query?: any;
    }): Promise<any>;
    _findOrGet(id: Id, params?: {}): Promise<A | A[]>;
    _create(data: any, params: Params & {
        rethinkdb?: InsertOptions;
    }): Promise<any>;
    _patch(id: Id, data: any, params: Params & {
        rethinkdb?: UpdateOptions;
    }): Promise<any>;
    _update(id: Id, data: any, params: {
        rethinkdb?: UpdateOptions;
    }): Promise<any>;
    _remove(id: string, params: Params & {
        rethinkdb?: DeleteOptions;
    }): Promise<any>;
    watchChangefeeds(this: Service<A> & EventEmitter, app: Application): any;
    setup(this: Service<A> & EventEmitter, app: Application): Promise<void>;
}
export default function (options: Options): Service<unknown>;
export { Service };
