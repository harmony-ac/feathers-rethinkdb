import { R, RDatum } from 'rethinkdb-ts/lib/types';
export declare function createFilter<T>(query: any, r: R): (doc: any) => RDatum<any>;
