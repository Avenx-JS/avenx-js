const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const benchesDir = __dirname;
const files = fs.readdirSync(benchesDir).filter(f => f.endsWith('.bench.js'));

const isJson = process.argv.includes('--json');
const results = [];

if (!isJson) {
    console.log('--- Avenx-JS Benchmarks ---');
    console.log(`Found ${files.length} benchmarks.\n`);
}

files.forEach(file => {
    if (!isJson) console.log(`[Running] ${file}`);
    const result = spawnSync('node', [path.join(benchesDir, file)], { encoding: 'utf-8' });
    
    const output = result.stdout;
    if (!isJson) {
        if (output) console.log(output);
        if (result.stderr) console.error(result.stderr);
        console.log('---------------------------');
    } else {
        // Parse output
        const nameMatch = output.match(/Running (.*?) benchmark/);
        const totalTimeMatch = output.match(/Total time: ([\d.]+)ms/);
        const avgTimeMatch = output.match(/Average time per .*?: ([\d.]+)ms/);
        const opsMatch = output.match(/Ops\/sec: (\d+)/);

        results.push({
            file,
            name: nameMatch ? nameMatch[1] : file,
            totalTime: totalTimeMatch ? parseFloat(totalTimeMatch[1]) : 0,
            avgTime: avgTimeMatch ? parseFloat(avgTimeMatch[1]) : 0,
            ops: opsMatch ? parseInt(opsMatch[1], 10) : 0,
            timestamp: new Date().toISOString()
        });
    }
});

if (isJson) {
    console.log(JSON.stringify(results, null, 2));
}
