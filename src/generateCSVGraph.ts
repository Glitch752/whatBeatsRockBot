import fs from 'fs';
import { ANSWER_DATA_FILE, AnswerData } from './answerData';

const GENERATE_INCORRECT_EDGES = false;
const LIMIT = -1; // The maximum number of correct answer pairs to load, or -1 for no limit

const answerData: AnswerData = JSON.parse(fs.readFileSync(ANSWER_DATA_FILE, 'utf8'));

if(LIMIT !== -1) answerData.correctAnswerMap = answerData.correctAnswerMap.slice(0, LIMIT);
if(LIMIT !== -1) answerData.incorrectAnswerMap = answerData.incorrectAnswerMap.slice(0, LIMIT);

console.log(`Loaded ${answerData.correctAnswerMap.length} correct answer pairs and ${answerData.incorrectAnswerMap.length} incorrect answer pairs! Generating CSV graph file...`);

const csvGraph = `from,to,type
${answerData.correctAnswerMap.map(([from, to]) => `"${from}","${to}","correct"`).join('\n')}
${GENERATE_INCORRECT_EDGES ? answerData.incorrectAnswerMap.map(([from, to]) => `"${from}","${to}","incorrect"`).join('\n') : ''}`;

let csvGraphPath = 'graph.csv';

fs.writeFileSync(csvGraphPath, csvGraph);