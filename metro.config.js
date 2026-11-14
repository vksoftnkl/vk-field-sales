const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Drizzle migrations are .sql files; Metro must treat them as source.
config.resolver.sourceExts.push('sql');

module.exports = config;
