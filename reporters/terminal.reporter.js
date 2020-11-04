'use strict';

module.exports = (barrista, options = {}) => {
  if (process.stdout.isTTY && process.stdin.isTTY && options.reporters !== false) {
    const { Spinner } = require('barrkeep/progress');

    const stream = process.stdout;
    const specs = { };

    const slots = [ false ];
    if (barrista.config.parallel) {
      for (let i = 1; i < barrista.config.concurrency; i++) {
        slots.push(false);
      }
    }

    barrista.on('before', () => {
      console.log(`\x1b[H\x1b[2J\x1b[?25hBarrista v${ barrista.version } starting...`);
    });

    barrista.on('before-spec', (spec) => {
      const slot = {
        index: 0,
        spec,
      };

      for (let index = 0; index < slots.length; index++) {
        if (!slots[index]) {
          slot.index = index;
          slots[index] = slot;
          break;
        }
      }

      slot.y = 1 + slot.index;

      specs[spec.name] = slot;

      slot.spinner = new Spinner({
        prepend: `  ${ spec.name }  `,
        spinner: 'dots',
        style: 'fg: DodgerBlue1',
        x: 0,
        y: slot.y,
        clear: true,
      });

      stream.cursorTo(0, slot.y);
      stream.clearLine(1);

      slot.spinner.start();
    });

    barrista.on('after-spec', (spec) => {
      const slot = specs[spec.name];

      slot.spinner.stop();
      stream.cursorTo(0, slot.y);
      console.log(`  ${ spec.name } ${ spec.state }`);

      slots[slot.index] = false;
    });

    barrista.on('after', (report) => {
      console.log();
      console.log(`Test Specs: ${ report.passed }, ${ report.items.length } total`);
      console.log(`Tests: ${ report.passed }, ${ report.items.length } total` );
      console.log(`Time: ${ report.stop - report.start }`);
    });
  }
};
