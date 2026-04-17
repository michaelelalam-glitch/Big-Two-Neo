// Mock for static image assets (PNG, JPG, GIF, WebP) in Jest tests.
// require('../../assets/image.png') returns 1 (a truthy numeric mock),
// which satisfies Image source prop type requirements without loading binary data.
export default 1;
