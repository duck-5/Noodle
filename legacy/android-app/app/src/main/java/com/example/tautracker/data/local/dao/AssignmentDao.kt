package com.example.tautracker.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.tautracker.data.local.entity.AssignmentEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface AssignmentDao {
    @Query("SELECT * FROM assignments ORDER BY dueDate ASC")
    fun getAllAssignments(): Flow<List<AssignmentEntity>>

    @Query("SELECT * FROM assignments WHERE courseId = :courseId ORDER BY dueDate ASC")
    fun getAssignmentsForCourse(courseId: Long): Flow<List<AssignmentEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insertAll(assignments: List<AssignmentEntity>)

    @Query("UPDATE assignments SET isDone = :isDone WHERE id = :assignmentId")
    fun updateAssignmentStatus(assignmentId: Long, isDone: Boolean)

    @Query("UPDATE assignments SET notes = :notes WHERE id = :assignmentId")
    fun updateAssignmentNotes(assignmentId: Long, notes: String?)
}
