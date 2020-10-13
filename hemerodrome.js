'use strict';

const vm = require('vm');
const async = require('async');
const fs = require('fs').promises;
const pp = require('barrkeep/pp');
const { join, resolve } = require('path');
const expect = require('barrkeep/expect');
const { merge, timestamp } = require('barrkeep/utils');

const defaults = {
  parrallel: true,
  concurrency: 5,
  timeout: 5000,
};

function Hemerodrome (options = {}) {
  this.config = merge(defaults, options, true);

  //////////

  this.addChains = (object) => {
    let value;
    if (object.object === 'test') {
      value = {
        beforeEach: Promise.resolve(),
        afterEach: Promise.resolve(),
      };
    } else {
      value = {
        main: Promise.resolve(),
        before: Promise.resolve(),
        after: Promise.resolve(),
      };
    }

    Object.defineProperty(object, 'chains', {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  };

  this.addScaffold = (object) => {
    this.setPrivate(object, 'before', []);
    this.setPrivate(object, 'after', []);
    this.setPrivate(object, 'beforeEach', []);
    this.setPrivate(object, 'afterEach', []);
  };

  this.setParent = (object, parent) => {
    Object.defineProperty(object, 'parent', {
      value: parent,
      writable: false,
      configurable: true,
      enumerable: false,
    });
  };

  this.setPrivate = (object, property, value) => {
    Object.defineProperty(object, property, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  };

  //////////

  this.cleanObject = (object, recurse = true) => {
    const keys = Object.getOwnPropertyNames(object);

    for (const key of keys) {
      if (!object.propertyIsEnumerable(key)) {
        delete object[key];
      }
    }

    if (recurse && Array.isArray(object.items)) {
      for (const item of object.items) {
        this.cleanObject(item);
      }
    }
  };

  //////////

  const root = {
    name: 'hemerodrome',
    object: 'results',
    items: [],
    state: 'ready',
    start: timestamp(),
    stop: -1,
  };

  this.addScaffold(root);

  //////////

  this.queue = async.queue(async (file) => {
    root.state = 'running';

    const spec = {
      object: 'spec',
      name: file.replace(/^(.*?)([^/]+)$/, '$2'),
      file,
      cwd: resolve(file.replace(/[^/]+$/, '')),
      items: [ ],
      state: 'running',
      start: timestamp(),
      stop: -1,
    };

    this.addChains(spec);
    this.addScaffold(spec);
    this.setParent(spec, root);

    root.items.push(spec);

    let parent = spec;

    //////////

    this.scaffoldWrapper = (type, ancestor, {
      name, func, timeout,
    }, chains) => {
      const scaffold = {
        object: 'scaffold',
        type,
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      this.setParent(scaffold, ancestor);
      this.setPrivate(scaffold, 'timeout', timeout === undefined ? scaffold.parent.timeout : timeout);

      chains = chains || scaffold.parent.chains;

      scaffold.parent.items.push(scaffold);
      console.log(type, name, scaffold.parent.name);

      chains[type] = chains[type].then(async () => {
        if (scaffold.timeout === 0) {
          return await func();
        }

        return Promise.race([
          func(),
          new Promise((resolve, reject) => {
            setTimeout(() => {
              reject(new Error(`Async callback not called within timeout of ${ scaffold.timeout }ms`));
            }, scaffold.timeout);
          }),
        ]);
      }).
        then(() => {
          scaffold.state = 'passed';
          scaffold.stop = timestamp();
        }).
        catch((error) => {
          scaffold.state = 'failed';
          scaffold.parent.state = scaffold.state;

          scaffold.error = error.toString();

          scaffold.stop = timestamp();
        });

      return scaffold.parent[type];
    };

    this.before = this.beforeAll = (name, func, timeout) => {
      parent.before.push({
        name,
        func,
        timeout,
      });
    };

    this.after = this.afterAll = (name, func, timeout) => {
      parent.after.push({
        name,
        func,
        timeout,
      });
    };

    this.beforeEach = (name, func, timeout) => {
      parent.beforeEach.push({
        name,
        func,
        timeout,
      });
    };

    this.afterEach = (name, func, timeout) => {
      parent.afterEach.push({
        name,
        func,
        timeout,
      });
    };

    //////////

    this.describe = (name, func, timeout = this.config.timeout) => {
      console.log('parent', parent.name);

      const suite = {
        object: 'suite',
        name,
        items: [ ],
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      this.addChains(suite);
      this.addScaffold(suite);
      this.setParent(suite, parent);
      this.setPrivate(suite, 'timeout', timeout);

      suite.parent.chains.main = suite.parent.chains.main.
        then(() => {
          suite.parent.before.forEach((item) => {
            this.scaffoldWrapper('before', suite.parent, item);
          });

          return suite.chains.before;
        }).
        then(async () => {
          console.log(suite.parent.name);
          suite.parent.items.push(suite);

          parent = suite;

          console.log('describe', name, suite.parent.name);
          await func();
        }).
        then(async () => {
          await suite.chains.main;

          if (suite.state === 'failed') {
            suite.parent.state = suite.state;
          } else {
            suite.state = 'passed';
          }

          suite.stop = timestamp();

          parent = suite.parent;
        }).
        catch(async (error) => {
          await suite.chains.main;

          suite.state = 'failed';
          suite.parent.state = suite.state;
          suite.error = error.toString();
          suite.stop = timestamp();

          parent = suite.parent;
        }).
        then(() => {
          suite.parent.after.forEach((item) => {
            this.scaffoldWrapper('after', suite.parent, item);
          });
          return suite.chains.after;
        });

      return suite.chains.main;
    };

    this.it = (name, func, timeout) => {
      const test = {
        object: 'test',
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      this.setParent(test, parent);
      this.addChains(test);
      this.setPrivate(test, 'timeout', timeout === undefined ? parent.timeout : timeout);

      test.parent.chains.main = test.parent.chains.main.
        then(() => {
          test.parent.beforeEach.forEach((item) => {
            this.scaffoldWrapper('beforeEach', test.parent, item, test.chains);
          });

          return test.chains.beforeEach;
        }).
        then(async () => {
          console.log('it', name, parent.name);
          test.parent.items.push(test);

          if (test.timeout === 0) {
            return await func();
          }

          return Promise.race([
            func(),
            new Promise((resolve, reject) => {
              setTimeout(() => {
                reject(new Error(`Async callback not called within timeout of ${ test.timeout }ms`));
              }, test.timeout);
            }),
          ]);
        }).
        then(() => {
          test.state = 'passed';
          test.stop = timestamp();
        }).
        catch((error) => {
          test.state = 'failed';
          test.parent.state = test.state;

          test.error = error.toString();

          test.stop = timestamp();
        }).
        then(() => {
          test.parent.afterEach.forEach((item) => {
            this.scaffoldWrapper('afterEach', test.parent, item, test.chains);
          });

          return test.chains.afterEach;
        });

      return test.parent.chains.main;
    };

    let cwd = spec.cwd;

    let context = {
      after: this.after,
      afterAll: this.after,
      afterEach: this.afterEach,
      before: this.before,
      beforeAll: this.beforeAll,
      beforeEach: this.beforeEach,
      clearImmediate,
      clearInterval,
      clearTimeout,
      console,
      describe: this.describe,
      expect,
      global,
      it: this.it,
      process,
      queueMicrotask,
      require (path) {
        if (/^[./]/.test(path)) {
          path = resolve(join(cwd, path));
        }
        return require(path);
      },
      setImmediate,
      setInterval,
      setTimeout,
    };

    vm.createContext(context);

    try {
      if (options.preload) {
        cwd = resolve(options.preload.replace(/[^/]+$/, ''));

        const preload = await fs.readFile(options.preload);

        await vm.runInContext(preload, context, {
          filename: file,
          breakOnSigint: true,
        });

        cwd = spec.cwd;
      }

      const code = await fs.readFile(file);

      vm.runInContext(code, context, {
        filename: file,
        breakOnSigint: true,
      });

      await spec.chains.main;
    } catch (error) {
      spec.state = 'failed';
      spec.error = error.toString();
    }

    if (spec.state === 'failed') {
      root.state = spec.state;
    } else {
      spec.state = 'passed';
    }

    spec.stop = timestamp();

    context = null;
    this.cleanObject(spec);
  }, this.config.parallel ? this.config.concurrency : 1);

  //////////

  this.queue.error((error, file) => {
    console.log('error', error, file);
  });

  this.queue.drain(() => {
    if (root.state !== 'failed') {
      root.state = 'passed';
    }

    root.stop = timestamp();

    console.log('Done!');

    pp(root);

    process.exit(root.state === 'failed' ? 1 : 0);
  });

  /////////

  this.addFiles = (files) => {
    this.queue.push(files);
  };
}

module.exports = Hemerodrome;
