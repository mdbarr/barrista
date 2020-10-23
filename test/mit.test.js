'use strict';

describe('mit test', () => {
  it('just normal', () => {
    console.log('normcore');
  });

  mit('miterator', () => new Promise((resolve) => {
    setTimeout(() => {
      resolve([ 1, 2, 3, 4, 5 ]);
    }, 1000);
  }), (value) => {
    console.log('got', value);
  });

  it('also plain', () => {
    console.log('plaincore');
  });

  describe('here we go again', () => {
    mit('sub-miterator', () => new Promise((resolve) => {
      setTimeout(() => {
        resolve([ 6, 7, 8 ]);
      }, 1000);
    }), (value) => {
      console.log('I haz', value);
    });
  });
});
