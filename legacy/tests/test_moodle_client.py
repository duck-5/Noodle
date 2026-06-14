import unittest
from unittest.mock import patch, MagicMock
import pytest
import requests

from config import MOODLE_URL, MOODLE_TOKEN
from clients.moodle_client import (
    get_enrolled_courses,
    get_pending_assignments,
    get_assignment_grades,
    get_course_contents,
    get_course_files,
    get_course_meetings,
    download_file,
    upload_submission,
    submit_assignment
)

class TestMoodleClient:
    @patch("clients.moodle_client.requests.get")
    def test_get_enrolled_courses_default(self, mock_get):
        # Setup mock responses
        mock_response_site = MagicMock()
        mock_response_site.json.return_value = {"userid": 12345}
        mock_response_site.status_code = 200
        
        mock_response_courses = MagicMock()
        mock_response_courses.json.return_value = [{"id": 1, "shortname": "0368111801-Math"}]
        mock_response_courses.status_code = 200
        
        mock_get.side_effect = [mock_response_site, mock_response_courses]
        
        courses = get_enrolled_courses()
        assert len(courses) == 1
        assert courses[0]["id"] == 1
        
        # Check defaults are used
        mock_get.assert_any_call(
            MOODLE_URL,
            params={
                "wstoken": MOODLE_TOKEN,
                "wsfunction": "core_webservice_get_site_info",
                "moodlewsrestformat": "json"
            }
        )


    @patch("clients.moodle_client.requests.get")
    def test_get_enrolled_courses_explicit(self, mock_get):
        mock_response_site = MagicMock()
        mock_response_site.json.return_value = {"userid": 54321}
        mock_response_site.status_code = 200
        
        mock_response_courses = MagicMock()
        mock_response_courses.json.return_value = [{"id": 2, "shortname": "03211100-Physics"}]
        mock_response_courses.status_code = 200
        
        mock_get.side_effect = [mock_response_site, mock_response_courses]
        
        custom_url = "http://custom-moodle.com"
        custom_token = "custom_token_123"
        courses = get_enrolled_courses(moodle_url=custom_url, moodle_token=custom_token)
        
        assert len(courses) == 1
        assert courses[0]["id"] == 2
        mock_get.assert_any_call(
            custom_url,
            params={
                "wstoken": custom_token,
                "wsfunction": "core_webservice_get_site_info",
                "moodlewsrestformat": "json"
            }
        )

    @patch("clients.moodle_client.get_enrolled_courses")
    @patch("clients.moodle_client.requests.get")
    @patch("clients.moodle_client.MOODLE_COURSES_LIST", [])
    def test_get_pending_assignments(self, mock_get, mock_enrolled):
        mock_enrolled.return_value = [{"id": 1, "shortname": "0368111801-Math", "idnumber": "03681118-01-2025-1"}]
        
        mock_response_assigns = MagicMock()
        mock_response_assigns.json.return_value = {
            "courses": [
                {
                    "id": 1,
                    "shortname": "0368111801-Math",
                    "assignments": [
                        {
                            "id": 101,
                            "cmid": 201,
                            "name": "Homework 1",
                            "duedate": 1800000000,
                            "allowsubmissionsfromdate": 0
                        }
                    ]
                }
            ]
        }
        mock_response_assigns.status_code = 200
        
        mock_response_status = MagicMock()
        mock_response_status.json.return_value = {
            "lastattempt": {
                "submission": {"status": "new"}
            }
        }
        mock_response_status.status_code = 200
        
        mock_get.side_effect = [mock_response_assigns, mock_response_status]
        
        assigns, mapping, metadata = get_pending_assignments(moodle_url="http://mock", moodle_token="token")
        
        assert len(assigns) == 1
        assert assigns[0]["assignment_name"] == "Homework 1"
        assert assigns[0]["status"] == "Assigned"

    @patch("clients.moodle_client.requests.get")
    def test_get_course_contents(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = [{"id": 1, "name": "General", "modules": []}]
        mock_response.status_code = 200
        mock_get.return_value = mock_response
        
        contents = get_course_contents(123, moodle_url="http://mock", moodle_token="token")
        assert len(contents) == 1
        assert contents[0]["name"] == "General"

    @patch("clients.moodle_client.get_course_contents")
    def test_get_course_files(self, mock_contents):
        mock_contents.return_value = [
            {
                "id": 1,
                "name": "Week 1",
                "modules": [
                    {
                        "id": 201,
                        "modname": "resource",
                        "name": "Lecture Slides",
                        "contents": [
                            {
                                "type": "file",
                                "filename": "slides.pdf",
                                "fileurl": "http://moodle/file.pdf",
                                "filesize": 1024,
                                "mimetype": "application/pdf",
                                "timemodified": 123456
                            }
                        ]
                    }
                ]
            }
        ]
        
        files = get_course_files(123, moodle_url="http://mock", moodle_token="token")
        assert len(files) == 1
        assert files[0]["file_name"] == "slides.pdf"
        assert files[0]["file_size"] == 1024

    @patch("clients.moodle_client.get_course_contents")
    def test_get_course_meetings(self, mock_contents):
        mock_contents.return_value = [
            {
                "id": 1,
                "name": "Meetings",
                "modules": [
                    {
                        "id": 301,
                        "modname": "url",
                        "name": "Zoom Link",
                        "contents": [
                            {
                                "type": "url",
                                "fileurl": "https://tau.zoom.us/j/123456"
                            }
                        ]
                    }
                ]
            }
        ]
        
        meetings = get_course_meetings(123, moodle_url="http://mock", moodle_token="token")
        assert len(meetings) == 1
        assert meetings[0]["meeting_url"] == "https://tau.zoom.us/j/123456"
        assert meetings[0]["type"] == "zoom"

    @patch("clients.moodle_client.requests.get")
    def test_download_file(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response
        
        response = download_file("http://moodle/file.pdf", "token123")
        mock_get.assert_called_with("http://moodle/file.pdf?token=token123", stream=True)

    @patch("clients.moodle_client.requests.post")
    def test_upload_submission(self, mock_post):
        mock_response_upload = MagicMock()
        mock_response_upload.json.return_value = {"itemid": 9876}
        mock_response_upload.status_code = 200
        
        mock_response_save = MagicMock()
        mock_response_save.json.return_value = []
        mock_response_save.status_code = 200
        
        mock_post.side_effect = [mock_response_upload, mock_response_save]
        
        result = upload_submission(101, "base64content", "test.pdf", "user1", moodle_url="http://mock", moodle_token="token")
        assert result["success"] is True
        assert result["itemid"] == 9876
