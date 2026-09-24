const html = `<a href="https://moodle.tau.ac.il/2025/mod/resource/view.php?id=135220" class=" aalink stretched-link" onclick="window.open('https://moodle.tau.ac.il/2025/mod/resource/view.php?id=135220&amp;redirect=1'); return false;">`;
const regex = /<a[^>]+href="([^"]*(?:pluginfile\.php|mod\/resource\/view\.php)[^"]*)"[^>]*>/i;
console.log(html.match(regex));
