/**
 * Environment variable helper
 * Provides backward compatibility for renamed environment variables
 */

/**
 * Get environment variable with backward compatibility
 * Supports both old and new variable names (new takes precedence)
 * @param {string} newName - New variable name
 * @param {string} oldName - Old variable name (for backward compatibility)
 * @param {string} defaultValue - Default value if neither is set
 * @returns {string|undefined}
 */
function getEnvVar(newName, oldName = null, defaultValue = undefined) {
  // New name takes precedence
  if (process.env[newName]) {
    return process.env[newName];
  }
  
  // Fall back to old name if provided
  if (oldName && process.env[oldName]) {
    // Warn about deprecated variable
    console.warn(`⚠️  DEPRECATED: ${oldName} is deprecated. Please use ${newName} instead.`);
    return process.env[oldName];
  }
  
  return defaultValue;
}

module.exports = {
  getEnvVar,
};

