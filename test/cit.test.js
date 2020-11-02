'use strict';

describe('cit test', () => {
  cit('always yes', true, () => {
    console.log('yup');
  });

  cit('always no', false, () => {
    console.log('not me');
  });

  cit('async yes', new Promise((resolve) => {
    setTimeout(() => { resolve(true); }, 500);
  }), () => {
    console.log('asyncly yes');
  });

  cit('async no', new Promise((resolve) => {
    setTimeout(() => { resolve(false); }, 500);
  }), () => {
    console.log('asyncly no');
  });

  it('normal', () => {
    console.log('normal');
  });
});
