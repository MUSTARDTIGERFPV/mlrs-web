
async function getVersions() {
    try {
        // Fetch the JSON response from the URL
        const url = 'https://raw.githubusercontent.com/olliw42/mLRS/main/tools/web/mlrs_firmware_urls.json'
        const response = await fetch(url);
        const data = await response.json();

        //console.log(response);
        //console.log(data);

        //console.log('-----');
        Object.keys(data).forEach(key => {
            //console.log(key);
            //console.log(data[key]);
            //console.log(data[key].commit);
            data[key].gitUrl = 'https://api.github.com/repos/olliw42/mLRS/git/trees/' + data[key].commit + '?recursive=true';
        });
        //console.log('-----');

        return data;
    } catch (error) {
        console.error('Error fetching data:', error);
        return [];
    }
}


// Pass in a GitHub tree URL like https://api.github.com/repos/olliw42/mLRS/git/trees/f12d680?recursive=true
async function getFilesFromTree(url) {
    try {
        // Fetch the JSON response from the URL
        const response = await fetch(url);
        const data = await response.json();

        // Extract and map the tree to get a list of file objects
        const files = data.tree
        .filter(item => item.type == 'blob')
        .filter(item => item.path.indexOf('firmware/') == 0)
        .filter(item => !item.path.includes('-esp'))
        .map(item => {
            return {
                name: item.path.split('.')
                    .slice(0, -1).join('.')
                    .replace(/^firmware\//, '').replace(/^release-/, '').replace(/^release/, 'stm32'),
                extension: item.path.split('.').slice(-1),
                downloadUrl: item.url
            };
        });

        return files;
    } catch (error) {
        console.error('Error fetching data:', error);
        return [];
    }
}
