module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 moved its worklet transform into react-native-worklets.
    // This plugin MUST be listed last. (For Reanimated 3 it would instead be
    // "react-native-reanimated/plugin".)
    plugins: ["react-native-worklets/plugin"],
  };
};
