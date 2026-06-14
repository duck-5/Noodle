package com.example.tautracker.data.repository

import com.example.tautracker.data.local.TauDatabase
import com.example.tautracker.data.local.entity.AssignmentEntity
import com.example.tautracker.data.local.entity.CourseEntity
import com.example.tautracker.data.remote.MoodleApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers

class SyncRepository(
    private val api: MoodleApi,
    private val db: TauDatabase
) {
    fun getVisibleCourses(): Flow<List<CourseEntity>> = db.courseDao().getVisibleCourses()

    fun getAllAssignments(): Flow<List<AssignmentEntity>> =
        db.assignmentDao().getAllAssignments()

    fun getAssignmentsForCourse(courseId: Long): Flow<List<AssignmentEntity>> =
        db.assignmentDao().getAssignmentsForCourse(courseId)

    suspend fun updateAssignmentNotes(assignmentId: Long, notes: String?) {
        withContext(Dispatchers.IO) {
            db.assignmentDao().updateAssignmentNotes(assignmentId, notes)
        }
    }

    suspend fun syncCoursesAndAssignments(token: String) {
        try {
            // Fetch userid
            val siteInfo = api.getSiteInfo(token)
            val userId = siteInfo.userid ?: 0L

            // Fetch courses
            val moodleCourses = api.getUsersCourses(token, userId)
            val courseEntities = moodleCourses.map { 
                CourseEntity(
                    id = it.id,
                    shortName = it.shortname,
                    fullName = it.fullname,
                    idNumber = it.idnumber
                )
            }
            db.courseDao().insertAll(courseEntities)

            // Fetch assignments
            val assignmentResponse = api.getAssignments(token)
            val assignmentEntities = mutableListOf<AssignmentEntity>()
            for (course in assignmentResponse.courses) {
                for (assignment in course.assignments) {
                    assignmentEntities.add(
                        AssignmentEntity(
                            id = assignment.id,
                            cmid = assignment.cmid,
                            name = assignment.name,
                            dueDate = assignment.duedate,
                            courseId = course.id
                        )
                    )
                }
            }
            db.assignmentDao().insertAll(assignmentEntities)

        } catch (e: Exception) {
            e.printStackTrace()
            // Handle sync error
        }
    }
}
