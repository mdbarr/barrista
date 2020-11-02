'use strict';

describe('mdescribe test', () => {
  mdescribe('mdescribe', () => new Promise((resolve) => {
    console.log('mdescribe value generator');
    setTimeout(() => {
      resolve([ 1, 2, 3, 4, 5 ]);
    }, 1000);
  }), (value) => {
    it('plain it', () => {
      console.log('plaincore', value);
    });

    it('another plain one', () => {
      console.log('still plain', value);
    });
  });
});
