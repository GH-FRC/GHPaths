// i18n 目录自检：EN 键位与 zh-CN 齐平 + zh-TW 派生样本输出
import { S } from '../src/ui-strings';
import { EN } from '../src/strings-en';
import * as OpenCC from 'opencc-js';

const zhKeys = Object.keys(S).sort();
const enKeys = Object.keys(EN).sort();
const missingInEn = zhKeys.filter(k => !(k in EN));
const extraInEn = enKeys.filter(k => !(k in S));
console.log('zh-CN keys:', zhKeys.length, '| en-US keys:', enKeys.length);
console.log('missing in EN:', missingInEn.length ? missingInEn : '无');
console.log('extra in EN:', extraInEn.length ? extraInEn : '无');

const s2tw = OpenCC.Converter({ from: 'cn', to: 'twp' });
const samples = [
  S.appName, S.hintReady, S.edHint, S.edViolation(5, 0.87),
  S.showNotStarted, S.stEstop, S.hintNoRobots, S.prefLangHint, S.tlBreaches(3),
  S.replayTime(1234, 56789, 1234567), S.chartThreshold(1.05),
];
console.log('--- zh-TW 派生样本 ---');
for (const s of samples) console.log(s2tw(s));
