
async function getDevices() {
    try {
        const data = { // this is easy enough to maintain by hand for the moment
            'MatekSys' : 'matek',
            'FrSky R9' : 'R9',
            'FlySky FRM 303' : 'FRM303',
            'Wio E5' : 'Wio-E5',
            'E77 MBL Kit' : 'E77-MBLKit',
            'Easysolder' : 'easysolder'
        };

        return data;
    } catch (error) {
        console.error('Error fetching data:', error);
        return [];
    }
}


async function getVersions() {
    try {
        // Fetch the JSON response from the URL
        const url = 'https://raw.githubusercontent.com/olliw42/mLRS/main/tools/web/mlrs_firmware_urls.json';
        const response = await fetch(url);
        const data = await response.json();

        //console.log(response);
        //console.log(data);

        //console.log('-----');
        Object.keys(data).forEach(key => {
            //console.log(key);
            //console.log(data[key]);
            //console.log(data[key].commit);
            var patch = parseInt(key.split('.').pop());
            //console.log(patch);
            if (patch == 0) { // .00
                data[key].versionStr = key + ' (release)';
            } else if ((patch % 1) > 0) { // odd
                data[key].versionStr = key + ' (dev)';
            } else if ((patch % 1) == 0) { // even
                data[key].versionStr = key + ' (pre-release)';
            } else {
                data[key].versionStr = key; // should not happen, play it safe
            }
            data[key].gitUrl = 'https://api.github.com/repos/olliw42/mLRS/git/trees/' + data[key].commit + '?recursive=true';
        });
        //console.log('-----');

        // Figure out also the pre-release dev version. This needs work:
        // We need to read the main json, to get the current firmware folder url,
        // then read one file name in this folder, and extract the version part from the file name
        const url_main = 'https://api.github.com/repos/olliw42/mLRS/git/trees/main';
        const response_main = await fetch(url_main);
        const data_main = await response_main.json();

        const firmware_url = data_main.tree
        .filter(item => item.type == 'tree')
        .filter(item => item.path == 'firmware');

        if (firmware_url.length != 1) {
            return data; // argh, something is wrong
        }

        const response_firmware = await fetch(firmware_url[0].url + '?recursive=true');
        const data_firmware = await response_firmware.json();

        const firmware_files = data_firmware.tree
        .filter(item => item.type == 'blob')
        .filter(item => item.path.includes('-stm32'))

        if (firmware_files.length == 0) {
            return data; // argh, something is wrong
        }

        const firmware_filename = firmware_files[0].path;

        // firmware_filename looks like pre-release-stm32/rx-E77-MBLKit-wle5cc-400-tcxo-v1.3.01-@ae667b78.hex
        // regex to get version and commit
        var res = firmware_filename.split('.').slice(0, -1).join('.'); // remove extension
        res = res.split('-').slice(-2).join('-'); // extract version part

        // we could check if that is a dev version by odd pathc number, but let's believe that's the case

        data[res] = {
            versionStr: res + ' (dev)',
            gitUrl: url_main + '?recursive=true'
        };

        return data;
    } catch (error) {
        console.error('Error fetching data:', error);
        return [];
    }
}


// Pass in a GitHub tree URL like https://api.github.com/repos/olliw42/mLRS/git/trees/f12d680?recursive=true
async function getFilesFromTree(device, url) {
    try {
        // Fetch the JSON response from the URL
        const response = await fetch(url);
        const data = await response.json();

        // Extract and map the tree to get a list of file objects
        const files = data.tree
        .filter(item => item.type == 'blob')
        .filter(item => item.path.indexOf('firmware/') == 0)
        .filter(item => !item.path.includes('-esp'))
        .filter(item => item.path.includes('x-' + device)) // tx-device-xxx or rx-device-xxx
        .map(item => {
            return {
                name: item.path.split('.')
                    .slice(0, -1).join('.')
                    //.replace(/^firmware\//, '').replace(/^release-/, '').replace(/^release/, 'stm32'),
                    .replace(/^firmware\//, '').replace(/^.*?\//, ''),
                extension: item.path.split('.').slice(-1),
                downloadUrl: item.url
            };
        });

        if (files.length == 0) {
            files.push({
                name: 'not available',
                extension: '',
                downloadUrl: ''
            });
        }

        return files;
    } catch (error) {
        console.error('Error fetching data:', error);
        return [];
    }
}
