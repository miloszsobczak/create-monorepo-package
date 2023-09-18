#!/usr/bin/env node

import chalk from 'chalk';
import figlet from 'figlet';
import inquirer, { Answers, QuestionCollection } from 'inquirer';
import axios from 'axios';
import util from 'util';
import fs, { promises } from 'fs';
import path from 'path';
import spawn from 'cross-spawn';

import packageJson from './package.json' assert { type: 'json' };

type LookUpRecord = Record<string, string>;

enum QuestionNames {
  PACKAGE_PATH = 'PACKAGE_PATH',
  PACKAGE_NAME = 'PACKAGE_NAME',
  NPM_USER_NAME = 'NPM_USER_NAME',
  GIT_USER_NAME = 'GIT_USER_NAME'
}

const { readFile, writeFile, readdir, stat, mkdir, rm, cp } = promises;
const exists = util.promisify(fs.exists);

const cacheDir = path.join(process.cwd(), '.create-package-monorepo-cache');

const askQuestions = () => {
    const questions: QuestionCollection<Answers & {
    name: QuestionNames;
  }> = [
      {
          name: QuestionNames.PACKAGE_PATH,
          type: 'input',
          message: 'Where do you want to create the NPM package?',
          default: '.',
          validate: value => {
              if (!value.length) {
                  return 'Please enter a path';
              }
              return true;
          }
      },
      {
          name: QuestionNames.PACKAGE_NAME,
          type: 'input',
          message: 'How do you want to name the NPM package?',
          validate: value => {
              if (!value.length) {
                  return 'Please enter a NPM package name';
              }
              return new Promise((resolve, reject) => {
                  axios.get(`https://www.npmjs.com/package/${encodeURIComponent(value)}`).then(() => {
                      reject('NPM Package already exists');
                  }).catch(() => {
                      resolve(true);
                  });
              });
          }
      },
      {
          name: QuestionNames.NPM_USER_NAME,
          type: 'input',
          message: 'What is your NPM username?',
          validate: value => {
              if (!value.length) {
                  return 'Please enter a NPM username';
              }
              return true;
          }
      },
      {
          name: QuestionNames.GIT_USER_NAME,
          type: 'input',
          message: 'What is your Github username?',
          validate: value => {
              if (!value.length) {
                  return 'Please enter a Github username';
              }
              return true;
          }
      }
  ];
    return inquirer.prompt(questions);
};

const cleanUp = async () => {
    if (await exists(cacheDir)) {
        await rm(cacheDir, { recursive: true });
    }
};

const copyFile = async (src: string, dest: string, encoding: BufferEncoding, lookUpRecord: LookUpRecord) => {
    const data = await readFile(src, { encoding });

    let replacedData = data;
    for (const [key, value] of Object.entries(lookUpRecord)) {
        const regex = new RegExp(key, 'g');
        replacedData = replacedData.replace(regex, value);
    }

    await writeFile(dest, replacedData, { encoding });
};

const copyDir = async (src: string, dest: string, encoding: BufferEncoding, lookUpRecord: LookUpRecord) => {
    const files = await readdir(src);

    for (const file of files) {
        const filePath = path.join(src, file);
        const fileStat = await stat(filePath);

        if (fileStat.isFile() || fileStat.isSymbolicLink()) {
            const destFileName = Object.keys(lookUpRecord).reduce(
                (acc, key) => acc.replace(new RegExp(key, 'g'), lookUpRecord[key]),
                file
            );
            const destFilePath = path.join(dest, destFileName);

            await copyFile(filePath, destFilePath, encoding, lookUpRecord);
        } else if (fileStat.isDirectory()) {
            const destDirName = Object.keys(lookUpRecord).reduce(
                (acc, key) => acc.replace(new RegExp(key, 'g'), lookUpRecord[key]),
                file
            );
            const destDir = path.join(dest, destDirName);

            await mkdir(destDir);
            await copyDir(filePath, destDir, encoding, lookUpRecord);
        }
    }
};

const writeDataToFiles = async (lookUpRecord: LookUpRecord) => {
    const templateDir = path.join(cacheDir, `node_modules/${packageJson.name}/.template`);
    const targetDir = path.join(cacheDir, '.template-cache');
    const encoding = 'utf-8';

    try {
        if (await exists(targetDir)) {
            await rm(targetDir, { recursive: true });
        }
        await mkdir(targetDir);

        // Start copying files
        await copyDir(templateDir, targetDir, encoding, lookUpRecord);
    } catch (err) {
        console.error(err);
        throw err; // Throw the error to propagate it
    }
};

const createCacheDir = async () => {
    if (await exists(cacheDir)) {
        await rm(cacheDir, { recursive: true });
    }
    await mkdir(cacheDir);
};

const installCurrentPackage = async () => {
    const { name, version } = packageJson;

    // install package in cache dir
    const child = spawn('npm', ['install', `${name}@${version}`], {
        cwd: cacheDir,
        stdio: 'inherit',
    });

    return new Promise<void>((resolve, reject) => {
        child.on('close', code => {
            if (code !== 0) {
                reject({
                    command: `npm install ${name}@${version}`,
                });
                return;
            }
            resolve();
        });
    });
};

const init = async () => {
    console.log(
        chalk.green(
            figlet.textSync('Create Package Monorepo', {
                font: 'Double',
                horizontalLayout: 'default',
                verticalLayout: 'default',
                width: 80,
                whitespaceBreak: true,
            })
        )
    );

    try {
        // create cache dir
        await createCacheDir();
        // install npm packages
        await installCurrentPackage();

        // ask questions
        const answers = await askQuestions();
        const { 
            [QuestionNames.PACKAGE_PATH]: packagePath = '.',
            [QuestionNames.PACKAGE_NAME]: packageName,
            [QuestionNames.NPM_USER_NAME]: userName,
            [QuestionNames.GIT_USER_NAME]: gitUserName,
        } = answers;

        const lookUpRecord: LookUpRecord = {
            '__MY_PACKAGE_NAME__': encodeURIComponent(packageName),
            '__MY_NPM_USER_NAME__': encodeURIComponent(userName),
            '__MY_GIT_USER_NAME__': encodeURIComponent(gitUserName),
        };

        const distPath = path.join(packagePath, packageName);

        await writeDataToFiles(lookUpRecord);
        
        await cp(
            path.join(cacheDir, '.template-cache'),
            distPath,
            { recursive: true }
        );
        await cleanUp();

        console.log(chalk.green(`\n\nSuccessfully created ${chalk.bold(packageName)}!\n\n`));
        console.log(chalk.italic(
            `The package can be found at ${chalk.bold(distPath)}.\n\n`
        ));
        console.log(chalk.italic(
            chalk.white(`Before continuing, please get yourself familiar with the ${chalk.bold('README.md')} file in the root of the project.\n\n`))
        );
    } catch (error) {
        console.error(error);
    }
};

init();

export default init;
