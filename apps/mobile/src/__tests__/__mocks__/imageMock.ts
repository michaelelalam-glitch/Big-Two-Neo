// Mock for static image assets (PNG, JPG, GIF, WebP) in Jest tests.
// require('../../assets/image.png') returns 1 (a truthy numeric mock),
// which satisfies Image source prop type requirements without loading binary data.
export default 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(module as any).exports = 1; // CJS compat: ts-jest require() returns 1 directly, not { default: 1 }
