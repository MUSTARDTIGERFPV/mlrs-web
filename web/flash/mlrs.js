// Pass in a GitHub tree URL like https://api.github.com/repos/olliw42/mLRS/git/trees/79c488b8843801c9128199e6505791ea684789a1?recursive=true
async function getFilesFromTree(url) {
  try {
    // Fetch the JSON response from the URL
    const response = await fetch(url);
    const data = await response.json();
    
    // Extract and map the tree to get a list of file objects
    const files = data.tree
    .filter(item => item.type == 'blob')
    .filter(item => !item.path.includes('-esp'))
    .map(item => {
      return {
        name: item.path.split('.')
	  .slice(0, -1).join('.')
	  .replace(/^release-/, ''),
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
