'use strict';

const vm = require('vm');
const async = require('async');
const pp = require('barrkeep/pp');
const fs = require('fs').promises;
const expect = require('barrkeep/expect');
const {
  dirname, join, resolve,
} = require('path');
const { merge, timestamp } = require('barrkeep/utils');
const {
  existsSync, readFileSync, statSync,
} = require('fs');

const defaults = {
  fastFail: true,
  parallel: true,
  concurrency: 5,
  timeout: 5000,
};

function Barrista (options = {}) {
  this.config = merge(defaults, options, true);

  //////////

  this.resolveFile = (path) => {
    const paths = [ path, `${ path }.js`, join(path, '/index.js') ];

    for (const item of paths) {
      if (existsSync(item)) {
        const stat = statSync(item);
        if (stat.isFile()) {
          return item;
        }
      }
    }

    return false;
  };

  this.require = (path, environment, baseContext) => {
    const filename = this.resolveFile(path);
    console.log('resolved', path, filename);

    if (!filename) {
      throw new Error(`No such file ${ path }`);
    }

    if (environment.cache.has(filename)) {
      console.log('cache hit', filename);
      return environment.cache.get(filename).exports;
    }

    console.log('cache miss', filename);

    const prevCwd = environment.cwd;
    environment.cwd = dirname(filename);

    const code = readFileSync(filename);
    const context = Object.assign({}, baseContext, {
      __dirname: environment.cwd,
      __filename: filename,
      module: { exports: {} },
      global: baseContext,
    });

    vm.createContext(context);

    environment.cache.set(filename, context.module);

    vm.runInContext(code, context, {
      filename: path,
      breakOnSigint: true,
    });

    environment.cwd = prevCwd;

    return context.module.exports;
  };

  //////////

  this.addChains = (object) => {
    let value;
    if (object.object === 'test') {
      value = {
        beforeEach: Promise.resolve(),
        afterEach: Promise.resolve(),
      };
    } else if (object.object === 'generator') {
      value = { main: Promise.resolve() };
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
    name: 'barrista',
    object: 'results',
    items: [],
    state: 'ready',
    start: timestamp(),
    stop: -1,
    passed: 0,
    failed: 0,
    skipped: 0,
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
      passed: 0,
      failed: 0,
      skipped: 0,
    };

    this.addChains(spec);
    this.addScaffold(spec);
    this.setParent(spec, root);
    this.setPrivate(spec, 'timeout', this.config.timeout);

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
          scaffold.stop = timestamp();
          scaffold.state = 'passed';
        }).
        catch((error) => {
          scaffold.stop = timestamp();
          scaffold.state = 'failed';

          scaffold.error = error.toString() + error.stack;
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

    this.describe = (name, func, timeout = this.config.timeout, ...args) => {
      console.log('describe parent', parent.name);

      const suite = {
        object: 'suite',
        name,
        items: [ ],
        state: 'running',
        start: timestamp(),
        stop: -1,
        passed: 0,
        failed: 0,
        skipped: 0,
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
          await func(...args);
        }).
        then(async () => {
          await suite.chains.main;

          suite.stop = timestamp();

          parent = suite.parent;
        }).
        catch(async (error) => {
          await suite.chains.main;

          suite.stop = timestamp();

          suite.state = 'failed';
          suite.failed++;
          suite.error = error.toString() + error.stack;

          parent = suite.parent;
        }).
        then(() => {
          suite.parent.after.forEach((item) => {
            this.scaffoldWrapper('after', suite.parent, item);
          });
          return suite.chains.after;
        }).
        then(() => {
          if (suite.failed > 0) {
            suite.state = 'failed';
          } else if (suite.passed > 0) {
            suite.state = 'passed';
          } else {
            suite.state = 'skipped';
          }

          suite.parent.passed += suite.passed;
          suite.parent.failed += suite.failed;
          suite.parent.skipped += suite.skipped;
        });

      return suite.parent.chains.main;
    };

    this.mdescribe = (name, generate, func, timeout) => {
      const generator = {
        object: 'generator',
        type: 'mdescribe',
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      console.log('mdescribe trying...');

      this.setParent(generator, parent);
      this.addChains(generator);
      this.setPrivate(generator, 'timeout', timeout === undefined ? parent.timeout : timeout);

      generator.parent.chains.main = generator.parent.chains.main.
        then(async () => {
          console.log('fast fail', this.config.fastFail, generator.parent.state);

          if (generator.parent.state === 'skipped' || this.config.fastFail && generator.parent.failed > 0) {
            generator.stop = generator.start;
            generator.state = 'skipped';
            generator.parent.skipped++;

            generator.parent.items.push(generator);

            return true;
          }

          let values;

          return generator.chains.main.then(() => {
            console.log('mdescribe', name, parent.name);
            generator.parent.items.push(generator);

            if (Array.isArray(generate)) {
              values = generate;
              return values;
            }

            if (generator.timeout === 0) {
              return generate();
            }

            return Promise.race([
              generate(),
              new Promise((resolve, reject) => {
                setTimeout(() => {
                  reject(new Error(`Async callback not called within timeout of ${ generator.timeout }ms`));
                }, generator.timeout);
              }),
            ]);
          }).
            then((result) => {
              console.log('generator succeeded', result);
              values = result;

              generator.stop = timestamp();

              generator.state = 'passed';
              generator.parent.passed++;
            }).
            catch((error) => {
              console.log('generator failed');
              generator.stop = timestamp();
              generator.state = 'failed';
              generator.parent.failed++;

              generator.error = error.toString() + error.stack;
            }).
            then(async () => {
              const main = parent.chains.main;
              parent.chains.main = generator.chains.main;

              if (Array.isArray(values)) {
                for (let i = 0; i < values.length; i++) {
                  await this.describe(`${ name } - ${ i + 1 }`, func, timeout, values[i], i);
                }
              }

              parent.chains.main = main;
              return generator.chains.main;
            });
        });

      return generator.parent.chains.main;
    };

    this.xdescribe = (name, func, timeout = this.config.timeout) => {
      console.log('parent', parent.name);

      const suite = {
        object: 'suite',
        name,
        items: [ ],
        state: 'skipped',
        start: timestamp(),
        stop: -1,
        passed: 0,
        failed: 0,
        skipped: 0,
      };

      this.addChains(suite);
      this.setParent(suite, parent);
      this.setPrivate(suite, 'timeout', timeout);

      suite.parent.chains.main = suite.parent.chains.main.
        then(async () => {
          console.log(suite.parent.name);
          suite.parent.items.push(suite);

          parent = suite;

          console.log('xdescribe', name, suite.parent.name);
          await func();
        }).
        then(async () => {
          await suite.chains.main;
          suite.stop = timestamp();
          parent = suite.parent;
        }).
        catch(async (error) => {
          await suite.chains.main;
          suite.stop = timestamp();
          suite.failed++;
          suite.error = error.toString() + error.stack;
          parent = suite.parent;
        });

      return suite.parent.chains.main;
    };

    //////////

    this.it = (name, func, timeout, ...args) => {
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
          if (test.parent.state === 'skipped' || this.config.fastFail && test.parent.failed > 0) {
            test.stop = test.start;
            test.state = 'skipped';
            test.parent.skipped++;

            test.parent.items.push(test);

            return true;
          }
          test.parent.beforeEach.forEach((item) => {
            this.scaffoldWrapper('beforeEach', test.parent, item, test.chains);
          });

          return test.chains.beforeEach.
            then(async () => {
              console.log('it', name, parent.name);
              test.parent.items.push(test);

              if (test.timeout === 0) {
                return await func(...args);
              }

              return Promise.race([
                func(...args),
                new Promise((resolve, reject) => {
                  setTimeout(() => {
                    reject(new Error(`Async callback not called within timeout of ${ test.timeout }ms`));
                  }, test.timeout);
                }),
              ]);
            }).
            then(() => {
              test.stop = timestamp();

              test.state = 'passed';
              test.parent.passed++;
            }).
            catch((error) => {
              test.stop = timestamp();
              test.state = 'failed';
              test.parent.failed++;

              test.error = error.toString() + error.stack;
            }).
            then(() => {
              test.parent.afterEach.forEach((item) => {
                this.scaffoldWrapper('afterEach', test.parent, item, test.chains);
              });

              return test.chains.afterEach;
            });
        });

      return test.parent.chains.main;
    };

    this.mit = (name, generate, func, timeout) => {
      const generator = {
        object: 'generator',
        type: 'mit',
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      this.setParent(generator, parent);
      this.addChains(generator);
      this.setPrivate(generator, 'timeout', timeout === undefined ? parent.timeout : timeout);

      generator.parent.chains.main = generator.parent.chains.main.
        then(async () => {
          console.log('fast fail', this.config.fastFail, generator.parent.state);

          if (generator.parent.state === 'skipped' || this.config.fastFail && generator.parent.failed > 0) {
            generator.stop = generator.start;
            generator.state = 'skipped';
            generator.parent.skipped++;

            generator.parent.items.push(generator);

            return true;
          }

          let values;

          return generator.chains.main.then(() => {
            console.log('mit', name, parent.name);
            generator.parent.items.push(generator);

            if (Array.isArray(generate)) {
              values = generate;
              return values;
            }

            if (generator.timeout === 0) {
              return generate();
            }

            return Promise.race([
              generate(),
              new Promise((resolve, reject) => {
                setTimeout(() => {
                  reject(new Error(`Async callback not called within timeout of ${ generator.timeout }ms`));
                }, generator.timeout);
              }),
            ]);
          }).
            then((result) => {
              values = result;

              generator.stop = timestamp();

              generator.state = 'passed';
              generator.parent.passed++;
            }).
            catch((error) => {
              generator.stop = timestamp();
              generator.state = 'failed';
              generator.parent.failed++;

              generator.error = error.toString() + error.stack;
            }).
            then(async () => {
              console.log('here');
              const main = parent.chains.main;
              parent.chains.main = generator.chains.main;

              if (Array.isArray(values)) {
                for (let i = 0; i < values.length; i++) {
                  await this.it(`${ name } - ${ i + 1 }`, func, timeout, values[i], i);
                }
              }

              parent.chains.main = main;
              return generator.chains.main;
            });
        });

      return generator.parent.chains.main;
    };

    this.fit = (name) => {
      const test = {
        object: 'test',
        name,
        state: 'passed',
      };

      this.setParent(test, parent);

      test.parent.chains.main = test.parent.chains.main.
        then(() => {
          test.start = test.stop = timestamp();
          test.parent.passed++;
          test.parent.items.push(test);
        });

      return test.parent.chains.main;
    };

    this.xit = (name) => {
      const test = {
        object: 'test',
        name,
        state: 'skipped',
      };

      this.setParent(test, parent);

      test.parent.chains.main = test.parent.chains.main.
        then(() => {
          test.start = test.stop = timestamp();
          test.parent.skipped++;
          test.parent.items.push(test);
        });

      return test.parent.chains.main;
    };

    //////////

    const environment = {
      cache: new Map(),
      cwd: spec.cwd,
    };

    let context = {
      __dirname: spec.cwd,
      __filename: file,
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
      global: null,
      it: this.it,
      fit: this.fit,
      mdescribe: this.mdescribe,
      mit: this.mit,
      process,
      queueMicrotask,
      require: null,
      setImmediate,
      setInterval,
      setTimeout,
      xdescribe: this.xdescribe,
      xit: this.xit,
      xmit: this.xit,
    };

    context.global = context;

    context.require = (name) => {
      console.log('require', name, environment.cwd);

      if (/^[./]/.test(name)) {
        const path = resolve(environment.cwd, name);
        console.log('relative require', path);

        return this.require(path, environment, context);
      }

      const paths = [
        environment.cwd,
        join(environment.cwd, '/node_modules'),
        process.cwd(),
        join(process.cwd(), '/node_modules'),
      ];

      const path = require.resolve(name, { paths });
      return require(path);
    };

    vm.createContext(context);

    try {
      if (options.preload) {
        environment.cwd = resolve(options.preload.replace(/[^/]+$/, ''));

        const preload = await fs.readFile(options.preload);

        await vm.runInContext(preload, context, {
          filename: file,
          breakOnSigint: true,
        });

        environment.cwd = spec.cwd;
      }

      const code = await fs.readFile(file);

      vm.runInContext(code, context, {
        filename: file,
        breakOnSigint: true,
      });

      await spec.chains.main;
    } catch (error) {
      spec.state = 'failed';
      spec.error = error.toString() + error.stack;
    }

    spec.stop = timestamp();

    if (spec.failed > 0) {
      spec.state = 'failed';
      root.failed++;
    } else if (spec.passed > 0) {
      spec.state = 'passed';
      root.passed++;
    } else {
      spec.state = 'skipped';
      root.skipped++;
    }

    context = null;
    this.cleanObject(spec);
  }, this.config.parallel ? this.config.concurrency : 1);

  //////////

  this.queue.error((error, file) => {
    console.log('error', error, file);
  });

  this.queue.drain(() => {
    root.stop = timestamp();

    if (root.failed > 0) {
      root.state = 'failed';
    } else if (root.passed > 0) {
      root.state = 'passed';
    } else {
      root.state = 'skipped';
    }

    console.log('Done!');

    pp(root);

    process.exit(root.state === 'failed' ? 1 : 0);
  });

  /////////

  this.addFiles = (files) => {
    this.queue.push(files);
  };
}

module.exports = Barrista;
