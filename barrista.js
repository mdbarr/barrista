'use strict';

const vm = require('vm');
const async = require('async');
const stream = require('stream');
const fs = require('fs').promises;
const { Console } = require('console');
const expect = require('barrkeep/expect');
const {
  dirname, join, resolve,
} = require('path');
const { merge, timestamp } = require('barrkeep/utils');
const {
  existsSync, readFileSync, statSync,
} = require('fs');

const defaults = {
  concurrency: 5,
  fastFail: true,
  parallel: true,
  retries: {
    delay: 100,
    maximum: 10,
    throws: [ 'ReferenceError', 'SyntaxError', 'TypeError' ],
  },
  timeout: 5000,
};

function Barrista (options = {}) {
  this.config = merge(defaults, options, true);

  //////////

  const asValue = (value, ...args) => {
    if (typeof value === 'function') {
      return value(...args);
    }
    return value;
  };

  const hide = (object, property, value) => {
    Object.defineProperty(object, property, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  };

  const resolveFile = (path) => {
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

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const retry = (func, params, ...args) => Promise.resolve().
    then(async () => {
      try {
        params.attempts++;

        return await Promise.race([
          func(...args),
          new Promise((resolve, reject) => {
            setTimeout(() => {
              reject(new Error(`Async callback not called within timeout of ${ params.timeout }ms`));
            }, params.timeout);
          }),
        ]);
      } catch (error) {
        for (const name of this.config.retries.throws) {
          if (name === error.name) {
            throw error;
          }
        }

        if (params.attempts >= params.maximum) {
          throw error;
        } else {
          return delay(params.delay).
            then(() => retry(func, params, ...args));
        }
      }
    });

  const _require = (path, environment, baseContext) => {
    const filename = resolveFile(path);

    if (!filename) {
      throw new Error(`No such file ${ path }`);
    }

    if (environment.cache.has(filename)) {
      return environment.cache.get(filename).exports;
    }

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

  const addChains = (object) => {
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

  const addConsole = (spec) => {
    hide(spec, 'current', spec);

    const stdout = new stream.Writable();
    stdout._write = (chunk, encoding, next) => {
      if (spec.current) {
        if (!spec.current.stdout) {
          spec.current.stdout = '';
        }
        spec.current.stdout += chunk.toString();
      }
      return setImmediate(next);
    };

    const stderr = new stream.Writable();
    stderr._write = (chunk, encoding, next) => {
      if (spec.current) {
        if (!spec.current.stderr) {
          spec.current.stderr = '';
        }
        spec.current.stderr += chunk.toString();
      }
      return setImmediate(next);
    };

    hide(spec, 'console', new Console(stdout, stderr));
  };

  const addScaffold = (object) => {
    hide(object, 'before', []);
    hide(object, 'after', []);
    hide(object, 'beforeEach', []);
    hide(object, 'afterEach', []);
  };

  const setParent = (object, parent) => {
    Object.defineProperty(object, 'parent', {
      value: parent,
      writable: false,
      configurable: true,
      enumerable: false,
    });
  };

  //////////

  const cleanObject = (object, recurse = true) => {
    const keys = Object.getOwnPropertyNames(object);

    for (const key of keys) {
      if (!object.propertyIsEnumerable(key)) {
        delete object[key];
      }
    }

    if (recurse && Array.isArray(object.items)) {
      for (const item of object.items) {
        cleanObject(item);
      }
    }
  };

  //////////

  const events = {
    'before': new Set(),
    'before-spec': new Set(),
    'before-suite': new Set(),
    'before-test': new Set(),
    'after-test': new Set(),
    'after-suite': new Set(),
    'after-spec': new Set(),
    'after': new Set(),

    'passed': new Set(),
    'failed': new Set(),
    'skipped': new Set(),
  };

  this.emit = async (name, ...args) => {
    if (events[name]) {
      const promises = [];

      for (const func of events[name]) {
        promises.push(func(...args));
      }

      await Promise.all(promises);
    }
  };

  this.on = (name, func) => {
    if (events[name]) {
      events[name].add(func);
    }
  };

  this.off = (name, func) => {
    if (events[name]) {
      events[name].delete(func);
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

  //////////

  const queue = async.queue(async (file) => {
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

    addChains(spec);
    addScaffold(spec);
    addConsole(spec);
    setParent(spec, root);
    hide(spec, 'timeout', this.config.timeout);

    root.items.push(spec);

    await this.emit('before-spec', spec);

    let parent = spec;

    //////////

    const scaffoldWrapper = (type, ancestor, {
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

      setParent(scaffold, ancestor);
      hide(scaffold, 'timeout', timeout === undefined ? scaffold.parent.timeout : timeout);

      chains = chains || scaffold.parent.chains;

      scaffold.parent.items.push(scaffold);

      chains[type] = chains[type].then(async () => {
        spec.current = scaffold;

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
          ancestor.passed++;
          scaffold.state = 'passed';
        }).
        catch((error) => {
          scaffold.stop = timestamp();
          ancestor.failed++;
          scaffold.state = 'failed';

          scaffold.error = error.stack;
        });

      return scaffold.parent[type];
    };

    const before = (name, func, timeout) => {
      parent.before.push({
        name,
        func,
        timeout,
      });
    };

    const after = (name, func, timeout) => {
      parent.after.push({
        name,
        func,
        timeout,
      });
    };

    const beforeEach = (name, func, timeout) => {
      parent.beforeEach.push({
        name,
        func,
        timeout,
      });
    };

    const afterEach = (name, func, timeout) => {
      parent.afterEach.push({
        name,
        func,
        timeout,
      });
    };

    //////////

    const describe = (name, func, timeout = this.config.timeout, ...args) => {
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

      addChains(suite);
      addScaffold(suite);
      setParent(suite, parent);
      hide(suite, 'timeout', timeout);

      suite.parent.chains.main = suite.parent.chains.main.
        then(async () => {
          spec.current = suite;

          if (suite.parent.state === 'skipped' || this.config.fastFail && suite.parent.failed > 0) {
            suite.stop = suite.start;
            suite.state = 'skipped';
          }

          await this.emit('before-suite', suite);

          if (suite.state !== 'skipped') {
            suite.parent.before.forEach((item) => {
              scaffoldWrapper('before', suite.parent, item);
            });
          }

          return suite.chains.before;
        }).
        then(async () => {
          suite.parent.items.push(suite);

          parent = suite;

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
          suite.error = error.stack;

          parent = suite.parent;
        }).
        then(() => {
          if (suite.state !== 'skipped') {
            suite.parent.after.forEach((item) => {
              scaffoldWrapper('after', suite.parent, item);
            });
          }
          return suite.chains.after;
        }).
        then(async () => {
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

          await this.emit('after-suite', suite);
        });

      return suite.parent.chains.main;
    };

    const mdescribe = (name, generate, func, timeout) => {
      const generator = {
        object: 'generator',
        type: 'mdescribe',
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      setParent(generator, parent);
      addChains(generator);
      hide(generator, 'timeout', timeout === undefined ? parent.timeout : timeout);

      generator.parent.chains.main = generator.parent.chains.main.
        then(async () => {
          spec.current = generator;

          if (generator.parent.state === 'skipped' || this.config.fastFail && generator.parent.failed > 0) {
            generator.stop = generator.start;
            generator.state = 'skipped';
            generator.parent.skipped++;

            generator.parent.items.push(generator);

            return true;
          }

          let values;

          return generator.chains.main.then(() => {
            generator.parent.items.push(generator);

            if (Array.isArray(generate)) {
              values = generate;
              return values;
            }

            if (generator.timeout === 0) {
              return asValue(generate);
            }

            return Promise.race([
              asValue(generate),
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

              generator.error = error.stack;
            }).
            then(async () => {
              const main = parent.chains.main;
              parent.chains.main = generator.chains.main;

              if (Array.isArray(values)) {
                for (let i = 0; i < values.length; i++) {
                  await describe(`${ name } - ${ i + 1 }`, func, timeout, values[i], i);
                }
              }

              parent.chains.main = main;
              return generator.chains.main;
            });
        });

      return generator.parent.chains.main;
    };

    const xdescribe = (name, func, timeout = this.config.timeout) => {
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

      addChains(suite);
      setParent(suite, parent);
      hide(suite, 'timeout', timeout);

      suite.parent.chains.main = suite.parent.chains.main.
        then(async () => {
          spec.current = suite;

          suite.parent.items.push(suite);

          parent = suite;

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
          suite.error = error.stack;
          parent = suite.parent;
        });

      return suite.parent.chains.main;
    };

    //////////

    const it = (name, func, timeout, ...args) => {
      const test = {
        object: 'test',
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      setParent(test, parent);
      addChains(test);
      hide(test, 'timeout', timeout === undefined ? parent.timeout : timeout);

      test.parent.chains.main = test.parent.chains.main.
        then(async () => {
          spec.current = test;

          if (test.parent.state === 'skipped' || this.config.fastFail && test.parent.failed > 0) {
            test.stop = test.start;
            test.state = 'skipped';
            test.parent.skipped++;

            test.parent.items.push(test);

            return true;
          }

          await this.emit('before-test', test);

          test.parent.beforeEach.forEach((item) => {
            scaffoldWrapper('beforeEach', test.parent, item, test.chains);
          });

          return test.chains.beforeEach.
            then(async () => {
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

              test.error = error.stack;
              test.code = func.toString();
            }).
            then(async () => {
              test.parent.afterEach.forEach((item) => {
                scaffoldWrapper('afterEach', test.parent, item, test.chains);
              });

              await this.emit('after-test', test);

              return test.chains.afterEach;
            });
        });

      return test.parent.chains.main;
    };

    const cit = (name, condition, func, timeout, ...args) => {
      const test = {
        object: 'test',
        type: 'conditional',
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      setParent(test, parent);
      addChains(test);
      hide(test, 'timeout', timeout === undefined ? parent.timeout : timeout);

      test.parent.chains.main = test.parent.chains.main.
        then(async () => {
          spec.current = test;

          if (test.parent.state === 'skipped' || this.config.fastFail && test.parent.failed > 0) {
            test.stop = test.start;
            test.state = 'skipped';
            test.parent.skipped++;

            test.parent.items.push(test);

            return true;
          }

          const value = await asValue(condition);
          if (!value) {
            test.stop = timestamp();
            test.state = 'skipped';
            test.parent.skipped++;

            test.parent.items.push(test);

            return true;
          }

          //////////

          test.parent.beforeEach.forEach((item) => {
            scaffoldWrapper('beforeEach', test.parent, item, test.chains);
          });

          return test.chains.beforeEach.
            then(async () => {
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

              test.error = error.stack;
              test.code = func.toString();
            }).
            then(() => {
              test.parent.afterEach.forEach((item) => {
                scaffoldWrapper('afterEach', test.parent, item, test.chains);
              });

              return test.chains.afterEach;
            });
        });

      return test.parent.chains.main;
    };

    const fit = (name) => {
      const test = {
        object: 'test',
        name,
        state: 'passed',
      };

      setParent(test, parent);

      test.parent.chains.main = test.parent.chains.main.
        then(() => {
          spec.current = test;

          test.start = test.stop = timestamp();
          test.parent.passed++;
          test.parent.items.push(test);
        });

      return test.parent.chains.main;
    };

    const mit = (name, generate, func, timeout) => {
      const generator = {
        object: 'generator',
        type: 'mit',
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
      };

      setParent(generator, parent);
      addChains(generator);
      hide(generator, 'timeout', timeout === undefined ? parent.timeout : timeout);

      generator.parent.chains.main = generator.parent.chains.main.
        then(async () => {
          spec.current = generator;

          if (generator.parent.state === 'skipped' || this.config.fastFail && generator.parent.failed > 0) {
            generator.stop = generator.start;
            generator.state = 'skipped';
            generator.parent.skipped++;

            generator.parent.items.push(generator);

            return true;
          }

          let values;

          return generator.chains.main.then(() => {
            generator.parent.items.push(generator);

            if (Array.isArray(generate)) {
              values = generate;
              return values;
            }

            if (generator.timeout === 0) {
              return asValue(generate);
            }

            return Promise.race([
              asValue(generate),
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

              generator.error = error.stack;
            }).
            then(async () => {
              const main = parent.chains.main;
              parent.chains.main = generator.chains.main;

              if (Array.isArray(values)) {
                for (let i = 0; i < values.length; i++) {
                  await it(`${ name } - ${ i + 1 }`, func, timeout, values[i], i);
                }
              }

              parent.chains.main = main;
              return generator.chains.main;
            });
        });

      return generator.parent.chains.main;
    };

    const rit = (name, func, params = {}, ...args) => {
      const test = {
        object: 'test',
        type: 'retry',
        name,
        state: 'running',
        start: timestamp(),
        stop: -1,
        attempts: 0,
        maximum: params.maximum || this.config.retries.maximum,
      };

      setParent(test, parent);
      addChains(test);
      hide(test, 'delay', params.delay === undefined ? this.config.retries.delay : params.delay);
      hide(test, 'timeout', params.timeout === undefined ? parent.timeout : params.timeout);

      test.parent.chains.main = test.parent.chains.main.
        then(() => {
          spec.current = test;

          if (test.parent.state === 'skipped' || this.config.fastFail && test.parent.failed > 0) {
            test.stop = test.start;
            test.state = 'skipped';
            test.parent.skipped++;

            test.parent.items.push(test);

            return true;
          }
          test.parent.beforeEach.forEach((item) => {
            scaffoldWrapper('beforeEach', test.parent, item, test.chains);
          });

          return test.chains.beforeEach.
            then(async () => {
              test.parent.items.push(test);

              if (test.timeout === 0) {
                return await func(...args);
              }

              return retry(func, test, ...args);
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

              test.error = error.stack;
              test.code = func.toString();
            }).
            then(() => {
              test.parent.afterEach.forEach((item) => {
                scaffoldWrapper('afterEach', test.parent, item, test.chains);
              });

              return test.chains.afterEach;
            });
        });

      return test.parent.chains.main;
    };

    const xit = (name) => {
      const test = {
        object: 'test',
        name,
        state: 'skipped',
      };

      setParent(test, parent);

      test.parent.chains.main = test.parent.chains.main.
        then(() => {
          spec.current = test;

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
      after,
      afterAll: after,
      afterEach,
      before,
      beforeAll: before,
      beforeEach,
      cit,
      clearImmediate,
      clearInterval,
      clearTimeout,
      console: spec.console,
      describe,
      expect,
      fit,
      global: null,
      it,
      mdescribe,
      mit,
      process,
      queueMicrotask,
      require: null,
      retryIt: rit,
      rit,
      setImmediate,
      setInterval,
      setTimeout,
      xdescribe,
      xit,
      xcit: xit,
      xmit: xit,
    };

    context.global = context;

    context.require = (name) => {
      if (/^[./]/.test(name)) {
        const path = resolve(environment.cwd, name);

        return _require(path, environment, context);
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
      spec.error = error.stack;
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

    await this.emit('after-spec', spec);

    context = null;
    cleanObject(spec);
  }, this.config.parallel ? this.config.concurrency : 1);

  //////////

  queue.error((error, file) => {
    console.log('error', error, file);
  });

  queue.drain(async () => {
    root.stop = timestamp();

    if (root.failed > 0) {
      root.state = 'failed';
    } else if (root.passed > 0) {
      root.state = 'passed';
    } else {
      root.state = 'skipped';
    }

    await this.emit('after', root);

    console.log('Done!');

    process.exit(root.state === 'failed' ? 1 : 0);
  });

  queue.pause();

  /////////

  this.add = (...args) => {
    for (const files of args) {
      queue.push(files);
    }
  };

  //////////

  let started = false;

  this.start = async () => {
    if (!started) {
      started = true;
      await this.emit('before', root);
    }

    if (queue.paused) {
      queue.resume();
    }
  };

  this.done = (...args) => queue.drain(...args);
}

module.exports = Barrista;
