package com.example.tautracker.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.tautracker.data.local.entity.CourseEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CourseDao {
    @Query("SELECT * FROM courses WHERE isHidden = 0")
    fun getVisibleCourses(): Flow<List<CourseEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insertAll(courses: List<CourseEntity>)

    @Query("UPDATE courses SET customColorHex = :color WHERE id = :courseId")
    fun updateCourseColor(courseId: Long, color: String?)

    @Query("UPDATE courses SET isHidden = :isHidden WHERE id = :courseId")
    fun updateCourseVisibility(courseId: Long, isHidden: Boolean)
}
