import fetch from 'node-fetch';

const token = process.env.MOODLE_TOKEN;
if (!token) {
  console.log("Please set MOODLE_TOKEN environment variable.");
  process.exit(1);
}

async function testTimeline() {
  const params = new URLSearchParams();
  params.append('wstoken', token);
  params.append('wsfunction', 'core_course_get_enrolled_courses_by_timeline_classification');
  params.append('moodlewsrestformat', 'json');
  params.append('classification', 'past');
  params.append('limit', '100');
  params.append('offset', '0');
  params.append('sort', 'fullname');

  const res = await fetch('https://moodle.tau.ac.il/webservice/rest/server.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

testTimeline();
