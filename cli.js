#!/usr/bin/env node
'use strict';

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

  console.pp(argv);

  const tests = argv._;
  if (!tests.length) {
    tests.push('test/**/*.test.js');
  }

  const pattern = tests.length > 1 ? `{${ tests.join(',') }}` : tests[0];
  console.log(pattern);
  const files = await aglob(pattern);
  console.pp(files);

  barrista.addFiles(files);
})();
