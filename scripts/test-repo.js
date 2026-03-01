#!/usr/bin/env node

/**
 * Test Repos After GTM Injection
 *
 * Validates that injected GTM snippets don't break repo builds.
 * Supports multiple site types: static HTML, Jekyll, Hugo, Astro, Vite, etc.
 *
 * Usage:
 *   node scripts/test-repo.js <repo-path> <repo-name>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIGS = {
  'static-html': {
    detect: (repoPath) => {
      const htmlFiles = ['index.html', 'docs/index.html', 'public/index.html'];
      return htmlFiles.some(f => fs.existsSync(path.join(repoPath, f)));
    },
    build: null, // No build step
    test: testStaticHTML
  },
  'jekyll': {
    detect: (repoPath) => fs.existsSync(path.join(repoPath, '_config.yml')),
    build: 'bundle exec jekyll build',
    test: testBuildSuccess
  },
  'hugo': {
    detect: (repoPath) => fs.existsSync(path.join(repoPath, 'config.toml')) || fs.existsSync(path.join(repoPath, 'hugo.toml')),
    build: 'hugo --destination /tmp/hugo-test-build',
    test: testBuildSuccess
  },
  'astro': {
    detect: (repoPath) => fs.existsSync(path.join(repoPath, 'astro.config.mjs')) || fs.existsSync(path.join(repoPath, 'astro.config.js')),
    build: 'npm run build',
    test: testBuildSuccess
  },
  'vite': {
    detect: (repoPath) => {
      const pkg = readPackageJson(repoPath);
      return pkg?.scripts?.build &&
             (fs.existsSync(path.join(repoPath, 'vite.config.js')) ||
              fs.existsSync(path.join(repoPath, 'vite.config.ts')));
    },
    build: 'npm run build',
    test: testBuildSuccess
  },
  'nextjs': {
    detect: (repoPath) => fs.existsSync(path.join(repoPath, 'next.config.js')) || fs.existsSync(path.join(repoPath, 'next.config.mjs')),
    build: 'npm run build',
    test: testBuildSuccess
  },
  'npm-project': {
    detect: (repoPath) => fs.existsSync(path.join(repoPath, 'package.json')),
    build: 'npm install --legacy-peer-deps 2>/dev/null || npm install',
    test: testNPMAudit
  },
  'default': {
    detect: () => true,
    build: null,
    test: testStaticHTML
  }
};

function readPackageJson(repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  }
  return null;
}

// Test: Static HTML validity
function testStaticHTML(repoPath, testName) {
  const results = { passed: true, warnings: [], errors: [] };

  // Find all HTML files
  const htmlFiles = [];
  const locations = [
    'index.html',
    'docs/index.html',
    'public/index.html',
    'dist/index.html',
    'build/index.html'
  ];

  for (const loc of locations) {
    const fullPath = path.join(repoPath, loc);
    if (fs.existsSync(fullPath)) {
      htmlFiles.push(fullPath);
    }
  }

  if (htmlFiles.length === 0) {
    results.warnings.push('No HTML files found to validate');
    return results;
  }

  // Check each HTML file for GTM snippet validity
  for (const htmlFile of htmlFiles) {
    const content = fs.readFileSync(htmlFile, 'utf8');
    const relativePath = path.relative(repoPath, htmlFile);

    // Check GTM snippet is present and valid
    const hasGTM = content.includes('googletagmanager.com/gtm.js') ||
                   content.includes('googletagmanager.com/ns.html');

    if (hasGTM) {
      // Check snippet structure
      if (!content.includes('<script>')) {
        results.errors.push(`${relativePath}: GTM script tag missing`);
        results.passed = false;
      }
      if (!content.includes('</script>')) {
        results.errors.push(`${relativePath}: GTM script tag not closed`);
        results.passed = false;
      }
      if (!content.includes('<!-- Google Tag Manager -->')) {
        results.warnings.push(`${relativePath}: GTM comment missing (but snippet present)`);
      }

      // Check GTM is in <head> or early in document
      const headIndex = content.toLowerCase().indexOf('<head>');
      const gtmIndex = content.indexOf('googletagmanager.com');
      if (headIndex !== -1 && gtmIndex !== -1 && gtmIndex < headIndex + 500) {
        // GTM is properly placed
      } else if (gtmIndex !== -1) {
        results.warnings.push(`${relativePath}: GTM snippet may not be optimally placed`);
      }
    }
  }

  return results;
}

// Test: Build success
function testBuildSuccess(repoPath, testName, buildCommand) {
  try {
    execSync(buildCommand, {
      cwd: repoPath,
      stdio: 'pipe',
      timeout: 120000 // 2 minute timeout
    });
    return { passed: true, warnings: [], errors: [] };
  } catch (error) {
    const output = error.stdout?.toString() || error.stderr?.toString() || error.message;
    return {
      passed: false,
      warnings: [],
      errors: [`Build failed: ${output.split('\n')[0]}`]
    };
  }
}

// Test: npm audit
function testNPMAudit(repoPath) {
  try {
    execSync('npm audit --audit-level=critical', {
      cwd: repoPath,
      stdio: 'pipe',
      timeout: 60000
    });
    return { passed: true, warnings: [], errors: [] };
  } catch (error) {
    // Audit found issues, but that's not a build breaker
    return {
      passed: true,
      warnings: ['npm audit found issues (review recommended)'],
      errors: []
    };
  }
}

// Detect site type
function detectSiteType(repoPath) {
  for (const [type, config] of Object.entries(TEST_CONFIGS)) {
    if (type === 'default') continue;
    if (config.detect(repoPath)) {
      return type;
    }
  }
  return 'default';
}

// Main test function
async function testRepo(repoPath, repoName) {
  console.log(`\nTesting repository: ${repoName}`);
  console.log(`Location: ${repoPath}`);

  const siteType = detectSiteType(repoPath);
  console.log(`Detected site type: ${siteType}`);

  const config = TEST_CONFIGS[siteType];
  const results = {
    repo: repoName,
    siteType,
    build: { passed: true, output: null },
    validation: null
  };

  // Run build if configured
  if (config.build) {
    console.log(`Running build: ${config.build}`);
    try {
      execSync(config.build, {
        cwd: repoPath,
        stdio: 'pipe',
        timeout: 120000
      });
      console.log('Build successful');
    } catch (error) {
      const output = error.stdout?.toString() || error.stderr?.toString() || error.message;
      console.log(`Build failed: ${output.split('\n')[0]}`);
      results.build = {
        passed: false,
        output: output.split('\n')[0]
      };

      // If build fails, don't run validation
      return results;
    }
  } else {
    console.log('No build step required');
  }

  // Run validation tests
  results.validation = config.test(repoPath, `${repoName}-${siteType}`, config.build);

  // Summary
  const overallPass = results.build.passed && (results.validation?.passed ?? true);
  console.log(`\nTest Result: ${overallPass ? 'PASS' : 'FAIL'}`);

  if (results.validation?.warnings?.length > 0) {
    console.log('Warnings:', results.validation.warnings);
  }
  if (results.validation?.errors?.length > 0) {
    console.log('Errors:', results.validation.errors);
  }

  return results;
}

// CLI entry point
if (require.main === module) {
  const [,, repoPath, repoName] = process.argv;

  if (!repoPath || !repoName) {
    console.log('Usage: node scripts/test-repo.js <repo-path> <repo-name>');
    process.exit(1);
  }

  testRepo(repoPath, repoName)
    .then(results => {
      const passed = results.build.passed && (results.validation?.passed ?? true);
      process.exit(passed ? 0 : 1);
    })
    .catch(error => {
      console.error('Test error:', error.message);
      process.exit(1);
    });
}

module.exports = testRepo;
