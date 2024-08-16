import fs from 'fs';
import { ANSWER_DATA_FILE, AnswerData } from './answerData';
import child_process from 'child_process';

const FILE_TYPE: string = 'png';
// Good options: dot, neato, fdp, sfdp, twopi, circo
// twopi in particular makes pretty readable graphs
const LAYOUT_ENGINE: string = 'dot';
const GENERATE_INCORRECT_EDGES = false;
const VERBOSE = false;
const LIMIT = -1; // The maximum number of correct answer pairs to load, or -1 for no limit

const answerData: AnswerData = JSON.parse(fs.readFileSync(ANSWER_DATA_FILE, 'utf8'));

if(LIMIT !== -1) answerData.correctAnswerMap = answerData.correctAnswerMap.slice(0, LIMIT);
if(LIMIT !== -1) answerData.incorrectAnswerMap = answerData.incorrectAnswerMap.slice(0, LIMIT);

console.log(`Loaded ${answerData.correctAnswerMap.length} correct answer pairs and ${answerData.incorrectAnswerMap.length} incorrect answer pairs! Generating dot graph...`);

const nodesWithoutOutgoingEdges = new Set<string>(answerData.correctAnswerMap.map(([from, to]) => to));
answerData.correctAnswerMap.forEach(([from, to]) => nodesWithoutOutgoingEdges.delete(from));

console.log(`Found ${nodesWithoutOutgoingEdges.size} nodes without outgoing answers!`);

function randomColor() {
    // https://www.graphviz.org/docs/attr-types/color/
    const hue = Math.random();
    return `"${hue} 0.8 0.5"`;
}

const dotGraph = `digraph {
    rankdir=LR;
    overlap="vpsc";
    concentrate=true;
    sep="+15";
    splines=${LAYOUT_ENGINE === "fdp" ? "compound" : "true"};

    K=1.0; # Spring constant, only used by fdp and sfdp
    repulsiveforce=1.5; # Repulsive force, only used by sfdp
    
    # Dark theme
    bgcolor=gray12;
    edge [color=gray50];
    node [color=gray80, fontcolor=gray80, style=filled, fillcolor=gray20, fontsize=12, shape=box, fontname="Calibri"];

    ${FILE_TYPE === "svg" ? "" : "dpi=200;"}

    outputorder=edgesfirst;

    # Highlight the rock node
    "rock" [color=green2, fillcolor=green4];

    # The label
    label="Generated graph of answer pairs; green edges are correct, red edges are incorrect. Red nodes have no outgoing edges, and the green node is the rock node.";
    fontsize=40;
    fontcolor=gray80;
    fontname="Calibri";

    ${answerData.correctAnswerMap.map(([from, to]) => `"${from}" -> "${to}" [color=${randomColor()}];`).join('\n')}
    ${GENERATE_INCORRECT_EDGES ? answerData.incorrectAnswerMap.map(([from, to]) => `"${from}" -> "${to}" [color=red];`).join('\n') : ''}
    
    # Highlight all nodes without any outgoing edges
    ${Array.from(nodesWithoutOutgoingEdges).map(node => `"${node}" [color=red2, fillcolor=red4];`).join('\n')}
}`;

let dotGraphPath = 'graph.dot';
const isBusy = (path: string) => {
    try {
        const fileHandle = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_EXCL);
        fs.closeSync(fileHandle);
        return false;
    } catch (error) {
        return error.code === 'EBUSY';
    }
};

while(isBusy(dotGraphPath)) {
    dotGraphPath = dotGraphPath.replace(/(\d+)?\./, (match, num) => `${(parseInt(num) || 0) + 1}.`);
}

console.log(`Writing dot graph to file ${dotGraphPath}...`);
fs.writeFileSync(dotGraphPath, dotGraph);

console.log(`Generating graph.${FILE_TYPE} with layout engine ${LAYOUT_ENGINE}...`);

const startTime = Date.now();

const dotChild = child_process.exec(`dot -T${FILE_TYPE} ${VERBOSE ? "-v" : ""} -K${LAYOUT_ENGINE} ${dotGraphPath} -o graph.${FILE_TYPE}`);

dotChild.stdout.on('data', data => {
    console.log(data);
});

dotChild.stderr.on('data', data => {
    if(VERBOSE) console.error(data);
});

dotChild.on('exit', code => {
    console.log(`Done in ${Date.now() - startTime}ms. Opening graph.${FILE_TYPE}.`);

    if(code !== 0) {
        console.error(`dot exited with code ${code}`);
    } else {
        child_process.execSync(`start graph.${FILE_TYPE}`);
    }
});