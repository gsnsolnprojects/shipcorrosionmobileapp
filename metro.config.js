const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// react-native-fast-tflite loads .tflite files via require(), so Metro needs
// to treat them as a bundleable asset (like an image), not source code.
config.resolver.assetExts.push("tflite");

module.exports = config;
