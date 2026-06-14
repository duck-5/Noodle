package com.example.tautracker.data.remote

import kotlinx.serialization.Serializable

@Serializable
data class MoodleSiteInfo(
    val userid: Long? = null,
    val exception: String? = null,
    val errorcode: String? = null,
    val message: String? = null
)

@Serializable
data class MoodleCourse(
    val id: Long,
    val shortname: String? = null,
    val fullname: String? = null,
    val idnumber: String? = null
)

@Serializable
data class MoodleAssignmentCourse(
    val id: Long,
    val fullname: String? = null,
    val shortname: String? = null,
    val assignments: List<MoodleAssignment> = emptyList()
)

@Serializable
data class MoodleAssignment(
    val id: Long,
    val cmid: Long,
    val name: String,
    val duedate: Long,
    val course: Long
)

@Serializable
data class MoodleAssignmentResponse(
    val courses: List<MoodleAssignmentCourse> = emptyList()
)

@Serializable
data class MoodleGradeTableResponse(
    val tables: List<MoodleGradeTable> = emptyList()
)

@Serializable
data class MoodleGradeTable(
    val courseid: Long,
    val tabledata: List<MoodleGradeTableData> = emptyList()
)

@Serializable
data class MoodleGradeTableData(
    val itemname: MoodleGradeItemInfo? = null,
    val grade: MoodleGradeItemInfo? = null,
    val range: MoodleGradeItemInfo? = null
)

@Serializable
data class MoodleGradeItemInfo(
    val content: String? = null
)

@Serializable
data class MoodleCourseSection(
    val id: Long,
    val name: String,
    val modules: List<MoodleCourseModule> = emptyList()
)

@Serializable
data class MoodleCourseModule(
    val id: Long,
    val name: String,
    val url: String? = null,
    val contents: List<MoodleModuleContent> = emptyList()
)

@Serializable
data class MoodleModuleContent(
    val type: String,
    val filename: String,
    val fileurl: String
)
