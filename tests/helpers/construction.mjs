// Existing scenarios assume a successful build; failure behavior is exercised with explicit rolls.
import {Construction as GameConstruction} from '../../src/construction.ts';
export * from '../../src/construction.ts';
export class Construction extends GameConstruction {
 constructor(...args){super(...args);this.random=()=>0;}
}
