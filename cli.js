#!/usr/bin/env node
'use strict';

const pp = require('barrkeep/pp');
const glob = require('glob');
const { argv } = require('yargs');
const Barrista = require('./barrista');

//////////

const aglob = (pattern, options) => new Promise((resolve, reject) => {
  glob(pattern, options, (error, result) => {
    if (error) {
      return reject(error);
    }
    return resolve(result);
  });
});

//////////

(async () => {
  const barrista = new Barrista(argv);

  barrista.on('after', (report) => {
    pp(report);
  });

  const tests = argv._;
  if (!tests.length) {
    tests.push('test/**/*.test.js');
  }

  const pattern = tests.length > 1 ? `{${ tests.join(',') }}` : tests[0];
  const files = await aglob(pattern);

  barrista.add(files);

  await barrista.start();
  await barrista.done();
})();
