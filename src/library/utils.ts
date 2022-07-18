import { Request } from "express"
import _ from "lodash"

import { Op, Model, ModelCtor, Sequelize, Config } from "sequelize";

export enum ControllerErrors {
  NOT_FOUND,
  BAD_REQUEST,
  UNKNOWN_ERROR
}

const OPERATOR_ALIASES = {
  $eq: Op.eq,
  $ne: Op.ne,
  $gte: Op.gte,
  $gt: Op.gt,
  $lte: Op.lte,
  $lt: Op.lt,
  $not: Op.not,
  $in: Op.in,
  $notIn: Op.notIn,
  $is: Op.is,
  $like: Op.like,
  $iLike: Op.iLike,
  $notLike: Op.notLike,
  $startsWith: Op.startsWith,
  $endsWith: Op.endsWith,
  $substring: Op.substring,
  $between: Op.between,
  $notBetween: Op.notBetween,
  $and: Op.and,
  $or: Op.or
};



export function sanitizeAttributes(attributes: any): any {
  // If `attributes` parameter is a string, try to interpret it as JSON
  if (_.isString(attributes)) {
    try {
      attributes = JSON.parse(attributes);
    } catch (e) {
      attributes = null;
    }
  }

  // if is array, leave as it is
  if (_.isArray(attributes)) {
    return attributes;
  }

  // allow only the object form
  if (!_.isObject(attributes)) attributes = {};

  // allow only include, exclude keys
  attributes = _.pick(attributes, "include", "exclude");
  if (!Array.isArray(attributes.include)) attributes.include = [];
  if (!Array.isArray(attributes.exclude)) attributes.exclude = [];

  // only string attributes
  attributes.include = attributes.include.map(a => String(a));
  attributes.exclude = attributes.exclude.map(a => String(a));

  return attributes;
}

function decodeQueryString(query: string, percentEncode) {
  // !	 #	 $	 &	 '	 (	 )	 *	 +	 ,	 /	 :	 ;	 =	 ?	 @	 [	 ]
  //%21	%23	%24	%26	%27	%28	%29	%2A	%2B	%2C	%2F	%3A	%3B	%3D	%3F	%40	%5B	%5D
  Object.keys(percentEncode).forEach(key => {
    query = query.replace(new RegExp(key, "g"), percentEncode[key]);
  });
  return query;
}

export function sanitizeWhere(where: any): any {
  const recursiveParse = (obj: any) => {
    _.each(obj, (val: any, key: any) => {
      if (OPERATOR_ALIASES.hasOwnProperty(key)) {
        obj[OPERATOR_ALIASES[key]] = val;
        delete obj[key];
      }

      if (_.isObjectLike(val)) {
        val = recursiveParse(val);
      }
    });
  };

  recursiveParse(where);

  return where;
}

export function parseId(req: Request): number {
  return parseInt(req.params.id);
}

export function parseBody(req: Request): any {
  const body = req.body;
  if (!_.isObject(body)) {
    throw ControllerErrors.UNKNOWN_ERROR;
  }
  return body;
}

export function parseWhere(req: Request, percentEncode): any {
  // Look for explicitly specified `where` parameter.
  let where: any = req.query.where;
  // If `where` parameter is a string, try to interpret it as JSON
  if (_.isString(where)) {
    try {
      where = decodeQueryString(where, percentEncode);
      where = JSON.parse(where);
    } catch (e) {
      where = null;
    }
  }
  // If `where` has not been specified, but other unbound parameter variables
  // **ARE** specified, build the `where` option using them.
  if (!where) {
    // Prune params which aren't fit to be used as `where` criteria
    // to build a proper where query
    where = req.params;
    // Omit built-in runtime config (like query modifiers)
    where = _.omit(where, ["limit", "skip", "sort"]);
    // Omit any params w/ undefined values
    where = _.omitBy(where, p => p === undefined);
  }

  // Merge with req.session.where (Useful for enforcing policies)
  if (req.session == null) req.session = {};
  where = _.merge(where, req.session.where || {});

  where = sanitizeWhere(where);

  // Return final `where`.
  return where;
}

export function parseLimit(req: Request, config: any): number {
  const limit = req.query.limit || config.api.limit;
  const result: number = +limit;
  return result;
}

export function parseOffset(req: Request, config: any): number {
  const skip = req.query.offset || req.query.skip || config.api.offset;
  const result: number = +skip;
  return result;
}

export function parseOrder(req: Request): any {
  try {
    let sort: any = req.query.order || req.query.sort;
    if (sort === undefined) {
      return undefined;
    }

    // If `sort` is a string, attempt to JSON.parse() it.
    // (e.g. `{"name": 1}`)
    if (_.isString(sort)) {
      try {
        sort = JSON.parse(sort);
      } catch (e) {
        // If it is not valid JSON, then fall back to interpreting it as-is.
        // (e.g. "name ASC")
        // Put it in array form for avoiding errors with reserved words
        try {
          const parts: Array<string> = sort.split(" ");
          const colName: string = parts[0];
          const orderParam: string = parts[1];
          if (orderParam !== "ASC" && orderParam !== "DESC")
            throw new Error("invalid query");
          sort = [[colName, orderParam]];
        } catch (e) {
          // Invalid string
          sort = "";
        }
      }
    }
    return sort;
  } catch (err) {
    console.log("Error on parseOrder:", err);
    throw ControllerErrors.BAD_REQUEST;
  }
}

export function parseAttributes(req: Request): any {
  // Look for explicitly specified `attributes` parameter.
  let attributes: any = req.query.attributes;

  if (!req.session) req.session = {};

  // validated object keys
  attributes = sanitizeAttributes(attributes);
  req.session.attributes = sanitizeAttributes(req.session.attributes);

  // if is array, just merge with req.session.attributes (Useful for enforcing policies)
  if (_.isArray(attributes)) {
    attributes = _.union(attributes, req.session.attributes);
    return attributes;
  }
  
  // Merge with req.session.attributes (Useful for enforcing policies)
  attributes.include = _.union(
    attributes.include,
    req.session.attributes.include
  );
  attributes.exclude = _.union(
    attributes.exclude,
    req.session.attributes.exclude
  );

  // remove 'exclude' values from 'includes' if neccesary and ignored if no values
  attributes.include = attributes.include.filter(
    a => !attributes.exclude.includes(a)
  );
  if (attributes.include.length == 0)
    attributes = _.pick(attributes, "exclude");

  // Return final `attributes`.
  return attributes;
}