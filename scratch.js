const html1 = '<input type="hidden" name="sesskey" value="XWAL">';
const html2 = 'var M = {}; M.cfg = {"wwwroot":"https:\/\/moodle.tau.ac.il","sesskey":"XWAL","loadingicon":""};';

const sesskeyMatch1 = html1.match(/(?:"sesskey":"([^"]+)"|name="sesskey" value="([^"]+)")/);
console.log(sesskeyMatch1 ? (sesskeyMatch1[1] || sesskeyMatch1[2]) : null);

const sesskeyMatch2 = html2.match(/(?:"sesskey":"([^"]+)"|name="sesskey" value="([^"]+)")/);
console.log(sesskeyMatch2 ? (sesskeyMatch2[1] || sesskeyMatch2[2]) : null);
