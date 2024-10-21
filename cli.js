#!/usr/bin/env node
'use strict';

const pp = require('barrkeep/pp');
const { glob } = require('glob');
const { argv } = require('yargs');
const Barrista = require('./barrista');

//////////

(async () => {
  const barrista = new Barrista(argv);

  //////////

  barrista.on('after', (report) => {
    if (argv.debug) {
      pp(report);
    }
  });

  require('./reporters/terminal.reporter.js')(barrista, argv);

  //////////

  const tests = argv._;
  if (!tests.length) {
    tests.push('test/**/*.test.js');
  }

  const pattern = tests.length > 1 ? `{${ tests.join(',') }}` : tests[0];
  const files = await glob(pattern);

  barrista.add(files);

  //////////

  await barrista.start();
  await barrista.done();
})();
