package com.example.tautracker.data.remote

import retrofit2.http.GET
import retrofit2.http.Query

interface MoodleApi {

    @GET("webservice/rest/server.php")
    suspend fun getSiteInfo(
        @Query("wstoken") token: String,
        @Query("wsfunction") wsfunction: String = "core_webservice_get_site_info",
        @Query("moodlewsrestformat") format: String = "json"
    ): MoodleSiteInfo

    @GET("webservice/rest/server.php")
    suspend fun getUsersCourses(
        @Query("wstoken") token: String,
        @Query("userid") userId: Long,
        @Query("wsfunction") wsfunction: String = "core_enrol_get_users_courses",
        @Query("moodlewsrestformat") format: String = "json"
    ): List<MoodleCourse>

    @GET("webservice/rest/server.php")
    suspend fun getAssignments(
        @Query("wstoken") token: String,
        @Query("wsfunction") wsfunction: String = "mod_assign_get_assignments",
        @Query("moodlewsrestformat") format: String = "json"
    ): MoodleAssignmentResponse

    @GET("webservice/rest/server.php")
    suspend fun getCourseContents(
        @Query("wstoken") token: String,
        @Query("courseid") courseId: Long,
        @Query("wsfunction") wsfunction: String = "core_course_get_contents",
        @Query("moodlewsrestformat") format: String = "json"
    ): List<MoodleCourseSection>

    @GET("webservice/rest/server.php")
    suspend fun getGradesTable(
        @Query("wstoken") token: String,
        @Query("userid") userId: Long,
        @Query("courseid") courseId: Long? = null,
        @Query("wsfunction") wsfunction: String = "gradereport_user_get_grades_table",
        @Query("moodlewsrestformat") format: String = "json"
    ): MoodleGradeTableResponse
}
