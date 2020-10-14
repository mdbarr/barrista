'use strict';

before('setup', () => {
  console.log('before');
});

after('cleanup', () => {
  console.log('after');
});

describe('foo', () => {
  let baz = 1;

  before('setup-2', () => {
    console.log('before-2');
  });

  describe('oof', () => {
    beforeEach('before-each', () => {
      console.log('beforeEach');
    });

    afterEach('after-each', () => {
      console.log('afterEach');
    });

    it('meh', () => {
      expect(baz).to.equal(1);
    }, 0);

    it('bar', () => {
      baz++;
      console.log('test', baz);

      expect(baz).to.equal(3);
    });

    it('skippable', () => {
      console.log('skip me on fast fail');
    });
  });
});
