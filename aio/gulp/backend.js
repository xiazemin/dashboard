// Copyright 2017 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Gulp tasks for compiling backend application.
 */
import del from 'del';
import fs from 'fs';
import gulp from 'gulp';
import lodash from 'lodash';
import path from 'path';

import conf from './conf';
import goCommand from './gocommand';

/**
 * Cleans packaged backend source to remove any leftovers from there.
 */
gulp.task('clean-packaged-backend-source', gulp.series(() => {
  return del([conf.paths.backendTmpSrc]);
}));

/**
 * Moves all backend source files (app and tests) to a temporary package directory where it can be
 * applied go commands.
 */
gulp.task('package-backend-source', gulp.series('clean-packaged-backend-source', () => {
  return gulp.src([path.join(conf.paths.backendSrc, '**/*')])
    .pipe(gulp.dest(conf.paths.backendTmpSrc));
}));

/**
 * Links vendor folder to the packaged backend source.
 */
gulp.task('link-vendor', gulp.series('package-backend-source', (doneFn) => {
  fs.symlink(conf.paths.backendVendor, conf.paths.backendTmpSrcVendor, 'dir', (err) => {
    if (err && err.code === 'EEXIST') {
      // Skip errors if the link already exists.
      doneFn();
    } else {
      doneFn(err);
    }
  });
}));

/**
 * Packages backend code to be ready for tests and compilation.
 */
gulp.task('package-backend', gulp.parallel('package-backend-source', 'link-vendor'));

/**
 * Compiles backend application in development mode and places the binary in the serve
 * directory.
 */
gulp.task('backend', gulp.series('package-backend', (doneFn) => {
  goCommand(
      [
        'build',
        // Install dependencies to speed up subsequent compilations.
        '-i',
        // record version info into src/version/version.go
        '-ldflags',
        conf.recordVersionExpression,
        // for debugging backend
        '-gcflags="all=-N -l"',
        '-o',
        path.join(conf.paths.serve, conf.backend.binaryName),
        conf.backend.mainPackageName,
      ],
      doneFn);
}));

/**
 * Compiles backend application in production mode for the current architecture and places the
 * binary in the dist directory.
 *
 * The production binary difference from development binary is only that it contains all
 * dependencies inside it and is targeted for a specific architecture.
 */
gulp.task('backend:prod', gulp.series('package-backend', () => {
  let outputBinaryPath = path.join(conf.paths.dist, conf.backend.binaryName);
  return backendProd([[outputBinaryPath, conf.arch.default]]);
}));

/**
 * Compiles backend application in production mode for all architectures and places the
 * binary in the dist directory.
 *
 * The production binary difference from development binary is only that it contains all
 * dependencies inside it and is targeted specific architecture.
 */
gulp.task('backend:prod:cross', gulp.series('package-backend', () => {
  let outputBinaryPaths =
      conf.paths.distCross.map((dir) => path.join(dir, conf.backend.binaryName));
  return backendProd(lodash.zip(outputBinaryPaths, conf.arch.list));
}));

/**
 * @param {!Array<!Array<string>>} outputBinaryPathsAndArchs array of
 *    (output binary path, architecture) pairs
 * @return {!Promise}
 */
function backendProd(outputBinaryPathsAndArchs) {
  let promiseFn = (path, arch) => {
    return (resolve, reject) => {
      goCommand(
          [
            'build',
            '-a',
            '-installsuffix',
            'cgo',
            // record version info into src/version/version.go
            '-ldflags',
            conf.recordVersionExpression,
            '-o',
            path,
            conf.backend.mainPackageName,
          ],
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          },
          {
            // Disable cgo package. Required to run on scratch docker image.
            CGO_ENABLED: '0',
            GOARCH: arch,
            GOOS: 'linux',
          });
    };
  };

  let goCommandPromises = outputBinaryPathsAndArchs.map(
      (pathAndArch) => new Promise(promiseFn(pathAndArch[0], pathAndArch[1])));

  return Promise.all(goCommandPromises);
}