package com.example.tautracker.domain.repository

import com.example.tautracker.data.remote.MoodleApi
import com.example.tautracker.data.remote.MoodleCourse
import com.example.tautracker.data.remote.MoodleAssignment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class CourseRepository(
    private val moodleApi: MoodleApi
) {

    suspend fun getEnrolledCourses(token: String): List<MoodleCourse> = withContext(Dispatchers.IO) {
        val siteInfo = moodleApi.getSiteInfo(token)
        val userId = siteInfo.userid ?: throw Exception("Invalid Token or User ID not found")
        moodleApi.getUsersCourses(token, userId)
    }

    suspend fun getPendingAssignments(token: String): List<MoodleAssignment> = withContext(Dispatchers.IO) {
        val response = moodleApi.getAssignments(token)
        response.courses.flatMap { it.assignments }
    }
}
