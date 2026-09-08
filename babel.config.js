module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Must be last — react-native-reanimated is a transitive dependency of
    // react-native-skia; without this plugin its native module never links.
    plugins: ["react-native-reanimated/plugin"],
  };
};
