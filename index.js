
/**
 * Module dependencies
 */

var url = require('url')
  , querystring = require('querystring')
  , httpReq = require('http').request
  , httpsReq = require('https').request
  , defaultVia = '1.1 ' + require('os').hostname();

/**
 * Export `API`
 */

module.exports = function(rules) {
  // Parse the rules to get flags, replace and match pattern
  rules = _parse(rules);

  return function(req, res, next) {
    var protocol = req.connection.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
      , callNext = true;

    rules.some(function(rule) {
      var location = protocol + '://' + req.headers.host + req.url.replace(rule.regexp, rule.replace)
        , match = rule.regexp.test(req.url);

      if(rule.host) {
        if(!rule.host.test(req.headers.host)) {
          return false;
        }
      }

      // If not match
      if(!match) {
        // Inverted rewrite
        if(rule.inverted) {
          req.url = rule.replace;
          return rule.last;
        }

        return false;
      }

      // Type
      if(rule.type) {
        res.setHeader('Content-Type', rule.type);
      }

      // Gone
      if(rule.gone) {
        res.writeHead(410);
        res.end();
        callNext = false;
        return true;
      }

      // Forbidden
      if(rule.forbidden) {
        res.writeHead(403);
        res.end();
        callNext = false;
        return true;
      }

      // Proxy
      if(rule.proxy) {
        _proxy(rule, {
          protocol : protocol,
          req : req,
          res : res,
          next : next
        });
        callNext = false;
        return true;
      }

      // Redirect
      if(rule.redirect) {
        res.writeHead(rule.redirect, {
          Location : location
        });
        res.end();
        callNext = false;
        return true;
      }

      // Rewrite
      if(!rule.inverted) {
        req.url = req.url.replace(rule.regexp, rule.replace);
        return rule.last;
      }
    });

    // Add to query object
    if(/\?.*/.test(req.url)) {
      req.params = req.query = querystring.parse(/\?(.*)/.exec(req.url)[1]);
    }

    if(callNext) {
      next();
    }

  };
};

/**
 * Regular expression flags
 */

var noCaseSyntax = /NC/
  , lastSyntax = /L/
  , proxySyntax = /P/
  , redirectSyntax = /R=?(\d+)?/
  , forbiddenSyntax = /F/
  , goneSyntax = /G/
  , typeSyntax = /T=([\w|\/]+,?)/
  , hostSyntax =  /H=(.+),?/
  , flagSyntax = /\[(.*)\]$/;

/**
 * Get flags from rule rules
 *
 * @param {Array.<rules>} rules
 * @return {Object}
 * @api private
 */

function _parse(rules) {
  return (rules || []).map(function(rule) {
    var parts = rule.replace(/\s+|\t+/g, ' ').split(' '), flags = '';

    if(flagSyntax.test(rule)) {
      flags = flagSyntax.exec(rule)[1];
    }

    // Check inverted urls
    var inverted = parts[0].substr(0, 1) === '!';
    if(inverted) {
      parts[0] = parts[0].substr(1);
    }

    var redirectValue = redirectSyntax.exec(flags)
      , typeValue = typeSyntax.exec(flags)
      , hostValue = hostSyntax.exec(flags);

    /* jshint ignore:start */
    return {
      regexp : typeof parts[2] !== 'undefined' && noCaseSyntax.test(flags) ? new RegExp(parts[0], 'i') : new RegExp(parts[0]),
      replace : parts[1],
      inverted : inverted,
      last : lastSyntax.test(flags),
      proxy : proxySyntax.test(flags),
      redirect : redirectValue ? (typeof redirectValue[1] !== 'undefined' ? redirectValue[1] : 301) : false,
      forbidden : forbiddenSyntax.test(flags),
      gone : goneSyntax.test(flags),
      type : typeValue ? (typeof typeValue[1] !== 'undefined' ? typeValue[1] : 'text/plain') : false,
      host : hostValue ? new RegExp(hostValue[1]) : false
    };
    /* jshint ignore:end */
  });
}

/**
 * Proxy the request
 *
 * @param {Object} rule
 * @param {Object} metas
 * @return {void}
 * @api private
 */

function _proxy(rule, metas) {
  var opts = _getRequestOpts(metas.req, rule)
    , request = /^https/.test(rule.replace) ? httpsReq : httpReq;

  var pipe = request(opts, function (res) {
    res.headers.via = opts.headers.via;
    metas.res.writeHead(res.statusCode, res.headers);
    res.on('error', function (err) {
      metas.next(err);
    });
    res.pipe(metas.res);
  });

  pipe.on('error', function (err) {
    metas.next(err);
  });

  if(!metas.req.readable) {
    pipe.end();
  } else {
    metas.req.pipe(pipe);
  }
}

/**
 * Get request options
 *
 * @param {HTTPRequest} req
 * @param {Object} rule
 * @return {Object}
 * @api private
 */

function _getRequestOpts(req, rule) {
  var opts = url.parse(req.url.replace(rule.regexp, rule.replace), true)
    , query = (opts.search != null) ? opts.search : '';

  if(query) {
    opts.path = opts.pathname + query;
  }
  opts.method  = req.method;
  opts.headers = req.headers;
  var via = defaultVia;
  if(req.headers.via) {
    via = req.headers.via + ', ' + via;
  }
  opts.headers.via = via;

  delete opts.headers['host'];

  return opts;
}
